#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTrustedMacRelease } from "./mac-release-config.mjs";
import { releaseSourceIdentity, assertReleaseSourceIdentity } from "./release-source-identity.mjs";
import { verifyMacInstaller } from "./verify-mac-installer.mjs";
import { createRequire } from "node:module";

const desktopRequire = createRequire(new URL("../desktop/package.json", import.meta.url));
const { getCurrentFuseWire, FuseV1Options, FuseState } = desktopRequire("@electron/fuses");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin")
  throw Error("Build Mac installers on macOS.");
const host = path.join(root, "desktop/apps/desktop");
const { version } = JSON.parse(
  await readFile(path.join(host, "package.json"), "utf8"),
);
async function find(directory, predicate, depth = 0) {
  if (depth > 5) return [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const result = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (predicate(file)) result.push(file);
    else if (entry.isDirectory())
      result.push(...(await find(file, predicate, depth + 1)));
  }
  return result;
}
const apps = await find(path.join(host, "out"), (file) =>
  file.endsWith(".app"),
);
const app = apps.find((file) => file.includes(`darwin-${process.arch}`));
if (!app)
  throw Error(
    `No ${process.arch} app bundle found. Run the Mac make command first.`,
  );
execFileSync(
  process.execPath,
  [path.join(host, "scripts/audit-packaged-resources.mjs"), app],
  { stdio: "inherit" },
);
const builtVersion = execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", path.join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();
if (builtVersion !== version) throw Error("The built application has a different release version.");
const source = JSON.parse(await readFile(path.join(app, "Contents/Resources/build-info.json"), "utf8"));
assertReleaseSourceIdentity(source, await releaseSourceIdentity());
const fuses = await getCurrentFuseWire(app);
const hardenedFuses = [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  FuseV1Options.EnableNodeCliInspectArguments, FuseV1Options.GrantFileProtocolExtraPrivileges]
  .every(option => fuses[option] === FuseState.DISABLE) &&
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]
  .every(option => fuses[option] === FuseState.ENABLE);
const installers = await find(path.join(host, "out/make"), (file) =>
  file.endsWith(".dmg"),
);
const installer = installers.find(
  (file) =>
    path.basename(file).includes(version) &&
    path.basename(file).includes(process.arch),
);
if (!installer) throw Error(`No ${version} ${process.arch} DMG found.`);
const destination = path.join(root, ".release/mac");
await mkdir(destination, { recursive: true });
const fileName = `HaoHuiXue-${version}-mac-${process.arch}.dmg`;
const target = path.join(destination, fileName);
const sha256 = createHash("sha256")
  .update(await readFile(installer))
  .digest("hex");
const signature = spawnSync("codesign", ["--display", "--verbose=4", app], {
  encoding: "utf8",
});
const details = signature.stderr + signature.stdout;
const identity = details.match(/^Authority=(.+)$/m)?.[1] ?? null;
const team = details.match(/^TeamIdentifier=(.+)$/m)?.[1] ?? null;
const notarized =
  spawnSync("xcrun", ["stapler", "validate", app], { encoding: "utf8" })
    .status === 0;
const signatureVerified =
  spawnSync("codesign", ["--verify", "--deep", "--strict", app], {
    encoding: "utf8",
  }).status === 0;
const developerIdSigned =
  signatureVerified &&
  Boolean(identity?.startsWith("Developer ID Application:"));
const dmgDetails = spawnSync(
  "codesign",
  ["--display", "--verbose=4", installer],
  { encoding: "utf8" },
);
const dmgSignature = dmgDetails.stdout + dmgDetails.stderr;
const installerSigned =
  dmgSignature.includes("Authority=Developer ID Application:") &&
  dmgSignature.includes(`TeamIdentifier=${team}\n`) &&
  spawnSync("codesign", ["--verify", "--strict", installer], {
    encoding: "utf8",
  }).status === 0;
const installerNotarized =
  spawnSync("xcrun", ["stapler", "validate", installer], { encoding: "utf8" })
    .status === 0;
const gatekeeperAccepted =
  spawnSync("spctl", ["--assess", "--type", "execute", app], {
    encoding: "utf8",
  }).status === 0;
const installerGatekeeperAccepted =
  spawnSync(
    "spctl",
    [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      installer,
    ],
    { encoding: "utf8" },
  ).status === 0;
assertTrustedMacRelease({
  hardenedFuses,
  developerIdSigned,
  signatureVerified,
  notarized,
  installerSigned,
  installerNotarized,
  gatekeeperAccepted,
  installerGatekeeperAccepted,
});
const installerContents = await verifyMacInstaller({
  installer, app, source, version,
  auditScript: path.join(host, "scripts/audit-packaged-resources.mjs"),
});
await copyFile(installer, target);
const manifest = {
  ...source,
  installerContents,
  hardenedFuses,
  product: "好会学 Desktop",
  version,
  platform: "darwin",
  arch: process.arch,
  file: fileName,
  bytes: (await stat(target)).size,
  sha256,
  developerIdSigned,
  signatureVerified,
  notarized,
  installerSigned,
  installerNotarized,
  gatekeeperAccepted,
  installerGatekeeperAccepted,
  signingTeam: team === "not set" ? null : team,
  distribution: "signed-and-notarized",
  setup: {
    providerSelection: "dropdown",
    recommendedProvider: "deepseek",
    modelDiscovery: "live-provider-list",
    manualFallback: true,
    optional: ["audio", "image", "search"],
  },
};
await writeFile(
  path.join(destination, "SHA256SUMS"),
  `${sha256}  ${fileName}\n`,
);
await writeFile(
  path.join(destination, "release-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest, null, 2));
