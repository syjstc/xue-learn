#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const localRequire = createRequire(join(workspaceRoot, "package.json"));
const cliRoot = dirname(localRequire.resolve("@electron-forge/cli/package.json"));
const cli = join(cliRoot, "dist/electron-forge.js");

if (!existsSync(cli)) {
  throw new Error(`Electron Forge CLI missing at ${cli}`);
}

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: desktopRoot,
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
