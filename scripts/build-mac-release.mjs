#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPackagingEnv } from "../desktop/apps/desktop/src/load-packaging-env.ts";
import { macNotaryArguments } from "./mac-release-config.mjs";
import { assertReleaseSourceIdentity, releaseSourceIdentity } from "./release-source-identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = path.join(root, "desktop/apps/desktop");
const stateRoot = path.join(root, ".release/notary");
const scrub = (text) =>
  process.env.APPLE_APP_SPECIFIC_PASSWORD
    ? text.split(process.env.APPLE_APP_SPECIFIC_PASSWORD).join("[redacted]")
    : text;

async function run(command, args, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(scrub(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(scrub(String(chunk)));
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(
            Error(
              scrub(
                `${path.basename(command)} failed (${code}): ${stderr || stdout}`,
              ),
            ),
          ),
    );
  });
}

const jsonFile = async (name) =>
  JSON.parse(
    await readFile(path.join(stateRoot, name), "utf8").catch(() => "null"),
  );
const save = async (name, value) =>
  writeFile(path.join(stateRoot, name), JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
const hashFile = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const hasStaple = async (file) => {
  try {
    await run("xcrun", ["stapler", "validate", file], true);
    return true;
  } catch {
    return false;
  }
};

async function notarize(artifact, ticketTarget, receiptName, auth) {
  if (await hasStaple(ticketTarget))
    return {
      ...((await jsonFile(receiptName)) ?? {}),
      status: "Accepted",
      stapled: true,
    };
  const sha256 = await hashFile(artifact);
  let receipt = await jsonFile(receiptName);
  if (!receipt || receipt.sha256 !== sha256) {
    const response = await run(
      "xcrun",
      ["notarytool", "submit", artifact, ...auth, "--output-format", "json"],
      true,
    );
    const submitted = JSON.parse(response.stdout);
    receipt = { id: submitted.id, status: "In Progress", sha256 };
    if (!receipt.id)
      throw Error("Apple did not return a notarization submission ID.");
    await save(receiptName, receipt);
  }
  console.log(`Apple notarization: ${path.basename(artifact)} · ${receipt.id}`);
  const response = await run(
    "xcrun",
    [
      "notarytool",
      "wait",
      receipt.id,
      ...auth,
      "--timeout",
      "20m",
      "--output-format",
      "json",
    ],
    true,
  );
  const completed = JSON.parse(response.stdout);
  receipt = { ...receipt, status: completed.status };
  await save(receiptName, receipt);
  if (receipt.status !== "Accepted") {
    const log = await run(
      "xcrun",
      ["notarytool", "log", receipt.id, ...auth],
      true,
    );
    await writeFile(
      path.join(stateRoot, receiptName + ".log.json"),
      scrub(log.stdout),
    );
    throw Error(
      `Apple notarization ${receipt.status}; see .release/notary/${receiptName}.log.json`,
    );
  }
  await run("xcrun", ["stapler", "staple", ticketTarget]);
  await run("xcrun", ["stapler", "validate", ticketTarget]);
  return { ...receipt, stapled: true };
}

async function main() {
  if (process.platform !== "darwin")
    throw Error("Build Mac releases on macOS.");
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw Error("Use Node.js 24 LTS from .nvmrc for Mac packaging.");
  await run(process.execPath, ["scripts/check-public-source.mjs"]);
  loadPackagingEnv({ cwd: host });
  if (!process.env.MACOS_SIGN_IDENTITY)
    throw Error(
      "Set MACOS_SIGN_IDENTITY to an existing Developer ID Application identity.",
    );
  const auth = macNotaryArguments(process.env);
  if (auth[0] === "--key" && !existsSync(auth[1]))
    throw Error("The Apple API private-key file was not found.");
  await run(
    "xcrun",
    ["notarytool", "history", ...auth, "--output-format", "json"],
    true,
  );
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  process.env.XUELEARN_MANAGED_MAC_NOTARIZATION = "1";
  const reuse = process.argv.includes("--finish-existing");
  if (!reuse)
    await run("pnpm", ["--dir", "desktop/apps/desktop", "run", "package"]);
  const { version } = JSON.parse(
    await readFile(path.join(host, "package.json"), "utf8"),
  );
  const app = path.join(
    host,
    `out/XueLearn-darwin-${process.arch}/XueLearn.app`,
  );
  const builtVersion = await run("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", path.join(app, "Contents/Info.plist")], true);
  if (builtVersion.stdout.trim() !== version)
    throw Error("The built application version does not match the release version.");
  assertReleaseSourceIdentity(
    JSON.parse(await readFile(path.join(app, "Contents/Resources/build-info.json"), "utf8")),
    await releaseSourceIdentity(),
  );
  await run("codesign", ["--verify", "--deep", "--strict", app]);
  const details = await run(
    "codesign",
    ["--display", "--verbose=4", app],
    true,
  );
  if (
    !(details.stderr + details.stdout).includes(
      `Authority=${process.env.MACOS_SIGN_IDENTITY}\n`,
    )
  )
    throw Error("The existing application uses a different signing identity.");
  const alreadyStapled = await hasStaple(app);
  const zip = path.join(stateRoot, "XueLearn-app.zip");
  if (!alreadyStapled) {
    await rm(zip, { force: true });
    await run("ditto", ["-c", "-k", "--keepParent", app, zip]);
  }
  const application = await notarize(zip, app, "app.json", auth);
  const dmg = path.join(host, `out/make/dmg/${process.arch}/好会学-${version}-${process.arch}.dmg`);
  const previous = await jsonFile("dmg.json");
  const pending =
    reuse &&
    alreadyStapled &&
    existsSync(dmg) &&
    previous?.sha256 === (await hashFile(dmg));
  if (!pending && !(reuse && existsSync(dmg) && (await hasStaple(dmg)))) {
    await run(process.execPath, [
      "desktop/apps/desktop/scripts/run-electron-forge.mjs",
      "make",
      "--skip-package",
    ]);
    await run("codesign", [
      "--force",
      "--timestamp",
      "--sign",
      process.env.MACOS_SIGN_IDENTITY,
      dmg,
    ]);
  }
  const installer = await notarize(dmg, dmg, "dmg.json", auth);
  await run(process.execPath, ["scripts/collect-mac-release.mjs"]);
  await writeFile(
    path.join(root, ".release/mac/notarization.json"),
    JSON.stringify({ application, installer }, null, 2) + "\n",
  );
}

main().catch((error) => {
  console.error(scrub(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
