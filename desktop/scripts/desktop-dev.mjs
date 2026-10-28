#!/usr/bin/env node
/**
 * Desktop-local development: Vite HMR for the renderer, esbuild watch for the
 * sidecar, then Electron. The window loads the Vite loopback origin; `/api` is
 * proxied to a fixed sidecar port so the launch token never leaves Electron's
 * session layer. Packaged builds still serve the compiled renderer from the sidecar.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { terminateDevChildren } from "./desktop-dev-processes.mjs";
import {
  focusRunningDesktop,
  prepareDesktopDevelopment,
} from "./desktop-dev-preflight.mjs";
import { ensureElectronRuntime } from "../apps/desktop/scripts/ensure-electron-runtime.mjs";
import {
  DESKTOP_DEV_RENDERER_ORIGIN,
  DESKTOP_DEV_SIDECAR_ORIGIN,
  DESKTOP_DEV_SIDECAR_PORT,
} from "./desktop-dev-defaults.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const labEnabled = process.env.XUELEARN_DESKTOP_ENABLE_LAB === "1";
const children = [];
let shuttingDown = false;

try {
  const executable = await ensureElectronRuntime();
  const shouldStart = await prepareDesktopDevelopment({
    labEnabled,
    focusExisting: () =>
      focusRunningDesktop(
        executable,
        join(root, "scripts/desktop-dev-focus.cjs"),
        { cwd: root },
      ),
  });
  if (!shouldStart) {
    process.stdout.write(
      "XueLearn is already running; requested focus on the existing window. To stop the old development instance, clear generated output and reload Electron main/preload changes, run pnpm desktop:restart (or pnpm desktop:clean to stop without relaunching).\n",
    );
    process.exit(0);
  }
} catch (error) {
  process.stderr.write(
    `[startup] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

process.env.VITE_ENABLE_DEV_TOOLS = "true";
process.env.XUELEARN_DESKTOP_DEV = "1";
process.env.XUELEARN_DESKTOP_RENDERER_URL = DESKTOP_DEV_RENDERER_ORIGIN;
process.env.XUELEARN_DESKTOP_SIDECAR_ORIGIN = DESKTOP_DEV_SIDECAR_ORIGIN;
process.env.XUELEARN_DESKTOP_SIDECAR_PORT = String(DESKTOP_DEV_SIDECAR_PORT);

const stubRenderer = join(root, "dist-desktop");
mkdirSync(stubRenderer, { recursive: true });
if (!existsSync(join(stubRenderer, "index.html"))) {
  writeFileSync(
    join(stubRenderer, "index.html"),
    "<!doctype html><title>XueLearn</title>\n",
  );
}

function spawnLogged(command, args, prefix) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    // On POSIX, give every top-level service its own process group so shutting
    // down this orchestrator also terminates pnpm/Forge grandchildren.
    detached: process.platform !== "win32",
  });
  children.push(child);
  const forward = (stream, target) => {
    child[stream]?.on("data", (chunk) => {
      const text = String(chunk);
      if (!text.trim()) return;
      target.write(`[${prefix}] ${text}`);
    });
  };
  forward("stdout", process.stdout);
  forward("stderr", process.stderr);
  child.on("error", (error) => {
    if (shuttingDown) return;
    process.stderr.write(`[${prefix}] could not start: ${error.message}\n`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown || signal) return;
    if (code !== 0 && code !== null) {
      process.stderr.write(`[${prefix}] exited with code ${code}\n`);
      shutdown(code);
    }
  });
  return child;
}

function waitForOutput(child, pattern, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}`));
    }, 180_000);
    const onExit = (code) => {
      clearTimeout(timeout);
      reject(new Error(`${label} exited before becoming ready (code ${code})`));
    };
    const onData = (chunk) => {
      if (!pattern.test(String(chunk))) return;
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      resolve();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  terminateDevChildren(children);
  setTimeout(() => process.exit(code), 200).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const renderer = spawnLogged(
  "pnpm",
  ["exec", "vite", "--config", "vite.desktop-local.config.ts"],
  "renderer",
);
const lab = labEnabled
  ? spawnLogged(
      "pnpm",
      ["exec", "vite", "--config", "apps/lab-runtime/vite.config.ts"],
      "lab",
    )
  : null;
const sidecar = spawnLogged(
  "node",
  ["scripts/build-service.mjs", "local-runtime", "--watch"],
  "sidecar",
);

try {
  await Promise.all([
    waitForOutput(
      renderer,
      /Local:\s+http:\/\/127\.0\.0\.1:5174|ready in/i,
      "renderer dev server",
    ),
    ...(lab
      ? [
          waitForOutput(
            lab,
            /Local:\s+http:\/\/127\.0\.0\.1:5177|ready in/i,
            "lab-runtime dev server",
          ),
        ]
      : []),
    waitForOutput(sidecar, /built local-runtime ->/, "sidecar watch"),
  ]);
} catch (error) {
  // A sibling killed during shutdown is a consequence of the first failure.
  // Keep the original diagnostic instead of reporting a sidecar failure too.
  if (!shuttingDown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    shutdown(1);
  }
  process.exit(1);
}

const labStatus = labEnabled
  ? "lab-runtime proxy to http://127.0.0.1:5177"
  : "lab-runtime disabled (set XUELEARN_DESKTOP_ENABLE_LAB=1 to enable)";
process.stdout.write(
  `Desktop hotload is active: Vite HMR at ${DESKTOP_DEV_RENDERER_ORIGIN}, ${labStatus}, API proxy to ${DESKTOP_DEV_SIDECAR_ORIGIN}. The normal XueLearn local profile is preserved and reused. Sidecar JS still restarts the local service. Electron main/preload still need a process restart.\n`,
);

const electron = spawnLogged(
  "pnpm",
  ["--dir", "apps/desktop", "start"],
  "electron",
);
electron.on("exit", (code) => {
  if (shuttingDown) return;
  shutdown(code ?? 0);
});
