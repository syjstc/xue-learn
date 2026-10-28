import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import {
  DESKTOP_DEV_RENDERER_HOST,
  DESKTOP_DEV_RENDERER_PORT,
  DESKTOP_DEV_SIDECAR_PORT,
} from "./desktop-dev-defaults.mjs";

const execute = promisify(execFile);

export async function focusRunningDesktop(
  executable,
  probePath,
  { cwd, env = process.env } = {},
) {
  const environment = { ...env };
  delete environment.ELECTRON_RUN_AS_NODE;
  try {
    await execute(executable, [probePath], {
      cwd,
      env: environment,
      timeout: 15_000,
    });
    return true;
  } catch (error) {
    if (error.code === 2) return false;
    throw new Error(
      `Could not check the existing XueLearn window: ${error.message}`,
      { cause: error },
    );
  }
}

export async function assertDevPortAvailable(port, label) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new Error(
            `${label} port ${port} is already in use. Run pnpm desktop:clean to stop this checkout's old development processes, then retry pnpm desktop:dev. If the conflict remains, inspect the port owner; cleanup does not stop unrelated applications.`,
            { cause: error },
          ),
        );
      } else reject(error);
    });
    server.listen(
      { host: DESKTOP_DEV_RENDERER_HOST, port, exclusive: true },
      () => {
        server.close((error) => (error ? reject(error) : resolve()));
      },
    );
  });
}

export async function prepareDesktopDevelopment({
  focusExisting,
  labEnabled = false,
  checkPort = assertDevPortAvailable,
}) {
  if (await focusExisting()) return false;
  // Check every required port before spawning Vite or rewriting the sidecar
  // bundle watched by a running host. Never terminate an unknown port owner.
  await checkPort(DESKTOP_DEV_RENDERER_PORT, "Renderer");
  await checkPort(DESKTOP_DEV_SIDECAR_PORT, "Local service");
  if (labEnabled) await checkPort(5177, "Lab runtime");
  return true;
}
