#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execute = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const localRequire = createRequire(join(workspaceRoot, "package.json"));
// Resolve transitive tools from the packages that own them. pnpm workspaces
// do not expose every transitive dependency beside Desktop's package.json.
const rebuildRequire = createRequire(localRequire.resolve("@electron/rebuild"));
const dmgRequire = createRequire(localRequire.resolve("@electron-forge/maker-dmg"));
const installerRequire = createRequire(dmgRequire.resolve("electron-installer-dmg"));
const appdmgRequire = createRequire(installerRequire.resolve("appdmg"));

export async function prepareDmgMaker() {
  const nodeRoot = resolve(dirname(process.execPath), "..");
  const nodeHeader = join(nodeRoot, "include/node/node.h");
  if (!existsSync(nodeHeader)) {
    throw new Error(
      `Cannot build DMG helper: missing Node header ${nodeHeader}`,
    );
  }
  const nodeGyp = rebuildRequire.resolve("node-gyp/bin/node-gyp.js");
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) {
      delete environment[key];
    }
  }
  environment.npm_config_nodedir = nodeRoot;
  environment.npm_config_loglevel = "error";

  const helpers = [
    ["macos-alias", "build/Release/volume.node"],
    ["fs-xattr", "build/Release/xattr.node"],
  ];
  for (const [packageName, binding] of helpers) {
    const packagePath = dirname(
      appdmgRequire.resolve(`${packageName}/package.json`),
    );
    const bindingPath = join(packagePath, binding);
    if (existsSync(bindingPath)) {
      try {
        await execute(process.execPath, ["-e", "require(process.argv[1])", bindingPath], {env:environment});
        continue;
      } catch {
        // A binding built by a different Node ABI must be rebuilt here.
      }
    }
    await execute(process.execPath, [nodeGyp, "rebuild", "--release"], {
      cwd: packagePath,
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!existsSync(bindingPath)) {
      throw new Error(
        `DMG helper build produced no native binding: ${bindingPath}`,
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  prepareDmgMaker()
    .then(() => process.stdout.write("DMG maker native helper is ready.\n"))
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
