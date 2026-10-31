#!/usr/bin/env node
import { execFile } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execute = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const localRequire = createRequire(join(workspaceRoot, "package.json"));
const electronRoot = dirname(localRequire.resolve("electron/package.json"));
const electronVersion = localRequire("electron/package.json").version;
const pathFile = join(electronRoot, "path.txt");

export function installedElectronPath(
  root = electronRoot,
  version = electronVersion,
) {
  try {
    const relativePath = readFileSync(join(root, "path.txt"), "utf8").trim();
    if (!relativePath) return null;
    if (
      readFileSync(join(root, "dist/version"), "utf8")
        .trim()
        .replace(/^v/, "") !== version
    )
      return null;
    const executable = join(root, "dist", relativePath);
    accessSync(executable, constants.X_OK);
    // A partial macOS extraction can contain the launcher but omit Chromium.
    if (
      process.platform === "darwin" &&
      !existsSync(
        join(
          root,
          "dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework",
        ),
      )
    )
      return null;
    return executable;
  } catch {
    return null;
  }
}

export async function ensureElectronRuntime() {
  const installed = installedElectronPath();
  if (installed) return installed;

  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) {
      delete environment[key];
    }
  }
  delete environment.ELECTRON_SKIP_BINARY_DOWNLOAD;
  environment.electron_config_cache = join(
    workspaceRoot,
    ".tools/electron-cache",
  );
  if (process.platform === "darwin") {
    // Keep Electron's downloader/checksums and use macOS's native ZIP extractor.
    const electronRequire = createRequire(join(electronRoot, "package.json"));
    const { downloadArtifact } = electronRequire("@electron/get");
    const archive = await downloadArtifact({
      version: electronVersion,
      artifactName: "electron",
      platform: process.platform,
      arch: process.arch,
      checksums: electronRequire("./checksums.json"),
    });
    await execute("/usr/bin/ditto", [
      "-x",
      "-k",
      archive,
      join(electronRoot, "dist"),
    ]);
    writeFileSync(pathFile, "Electron.app/Contents/MacOS/Electron");
  } else
    await execute(process.execPath, [join(electronRoot, "install.js")], {
      cwd: electronRoot,
      env: environment,
      maxBuffer: 4 * 1024 * 1024,
    });
  const repaired = installedElectronPath();
  if (!repaired) {
    throw new Error("Electron installer completed without a runnable binary");
  }
  return repaired;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  ensureElectronRuntime()
    .then((path) => process.stdout.write(`Electron runtime ready: ${path}\n`))
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
