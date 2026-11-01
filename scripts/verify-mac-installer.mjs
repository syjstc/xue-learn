import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertReleaseSourceIdentity } from "./release-source-identity.mjs";

/** Verify the application inside the actual download, then always unmount it. */
export async function verifyMacInstaller({ installer, app, source, version, auditScript }) {
  const temporary = await mkdtemp(path.join(tmpdir(), "xuelearn-installer-check-"));
  const volume = path.join(temporary, "volume");
  await mkdir(volume);
  let mounted = false;
  const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const codeDirectory = target => {
    const result = spawnSync("codesign", ["--display", "--verbose=4", target], { encoding: "utf8" });
    const hash = `${result.stderr}${result.stdout}`.match(/^CDHash=([a-f0-9]+)$/m)?.[1];
    if (result.status !== 0 || !hash) throw Error("Could not read the application signature's CodeDirectory hash.");
    return hash;
  };
  try {
    run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", volume, installer]);
    mounted = true;
    const entries = await readdir(volume, { withFileTypes: true });
    const names = entries.filter(entry => entry.isDirectory() && entry.name.endsWith(".app")).map(entry => entry.name);
    if (names.length !== 1) throw Error("The DMG must contain exactly one application.");
    const embedded = path.join(volume, names[0]);
    const applications = entries.find(entry => entry.isSymbolicLink() && ["应用程序", "Applications"].includes(entry.name));
    if (!applications || await readlink(path.join(volume, applications.name)) !== "/Applications")
      throw Error("The DMG Applications installation link is missing or invalid.");
    run("codesign", ["--verify", "--deep", "--strict", embedded]);
    if (codeDirectory(embedded) !== codeDirectory(app))
      throw Error("The DMG contains a different application from the verified build.");
    const embeddedVersion = run("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", path.join(embedded, "Contents/Info.plist")]);
    if (embeddedVersion !== version) throw Error("The application inside the DMG has a different version.");
    const identity = JSON.parse(await readFile(path.join(embedded, "Contents/Resources/build-info.json"), "utf8"));
    assertReleaseSourceIdentity(identity, source);
    execFileSync(process.execPath, [auditScript, embedded], { stdio: "inherit" });
    return { readOnlyMount: true, signatureValid: true, sameCodeDirectory: true, applicationsLinkValid: true, ...identity };
  } finally {
    // Do not recursively remove a mount point if detaching fails.
    if (mounted) run("hdiutil", ["detach", volume]);
    await rm(temporary, { recursive: true, force: true });
  }
}
