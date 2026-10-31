import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  macNotaryArguments,
  assertTrustedMacRelease,
  assertReleaseVersions,
} from "./mac-release-config.mjs";

test("release packaging rejects preview labels and mismatched app versions", () => {
  assert.doesNotThrow(() => assertReleaseVersions(["0.3.1", "0.3.1", "0.3.1"]));
  assert.throws(() => assertReleaseVersions(["0.3.1", "0.3.0"]), /must match/);
  assert.throws(() => assertReleaseVersions(["0.3.1-preview.1"]), /stable/);
  assert.throws(() => assertReleaseVersions([]), /stable/);
});
import { loadPackagingEnv } from "../desktop/apps/desktop/src/load-packaging-env.ts";
import { assertReleaseSourceIdentity } from "./release-source-identity.mjs";

test("release export refuses stale builds or uncommitted source", () => {
  const identity = { sourceCommit: "commit", sourceTreeSha256: "digest", sourceDirty: false };
  assert.doesNotThrow(() => assertReleaseSourceIdentity(identity, identity));
  assert.throws(() => assertReleaseSourceIdentity({ ...identity, sourceDirty: true }, identity), /clean committed/);
  assert.throws(() => assertReleaseSourceIdentity(identity, { ...identity, sourceDirty: true }), /clean committed/);
  assert.throws(() => assertReleaseSourceIdentity({ ...identity, sourceCommit: "other" }, identity), /different source/);
  assert.throws(() => assertReleaseSourceIdentity({ ...identity, sourceTreeSha256: "other" }, identity), /different source/);
});

test("DMG parser handles the real background and rejects the zero-length ICNS entry without hanging", () => {
  const require = createRequire(new URL("../desktop/package.json", import.meta.url));
  const maker = createRequire(require.resolve("@electron-forge/maker-dmg"));
  const installer = createRequire(maker.resolve("electron-installer-dmg"));
  const appdmg = installer.resolve("appdmg");
  const background = new URL("../desktop/apps/desktop/assets/dmg-background-zh-Hans.png", import.meta.url).pathname;
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import { createRequire } from 'node:module';
    import { readFileSync } from 'node:fs';
    import assert from 'node:assert/strict';
    const { imageSize } = createRequire(process.argv[1])('image-size');
    const size = imageSize(readFileSync(process.argv[2]));
    assert.equal(size.width, 660); assert.equal(size.height, 430);
    const hostile = Buffer.alloc(16);
    hostile.write('icns'); hostile.writeUInt32BE(16, 4); hostile.write('icp4', 8);
    assert.throws(() => imageSize(hostile));
  `, appdmg, background], { timeout: 2000 });
});

test("requires notarization credentials before packaging and supports existing Apple credentials", () => {
  assert.throws(() => macNotaryArguments({}), /require Apple notarization/);
  assert.deepEqual(
    macNotaryArguments({ APPLE_NOTARY_KEYCHAIN_PROFILE: "existing" }),
    ["--keychain-profile", "existing"],
  );
  assert.deepEqual(
    macNotaryArguments({
      APPLE_API_KEY: "/private/AuthKey_TESTKEY123.p8",
      APPLE_API_ISSUER: "issuer",
    }),
    [
      "--key",
      "/private/AuthKey_TESTKEY123.p8",
      "--key-id",
      "TESTKEY123",
      "--issuer",
      "issuer",
    ],
  );
  assert.throws(
    () => macNotaryArguments({ APPLE_API_KEY: "/private/key.p8" }),
    /APPLE_API_KEY_ID/,
  );
});
for (const missing of [
  "hardenedFuses",
  "developerIdSigned",
  "signatureVerified",
  "notarized",
  "installerSigned",
  "installerNotarized",
  "gatekeeperAccepted",
  "installerGatekeeperAccepted",
])
  test(`refuses to export when ${missing} is false`, () => {
    const ready = {
      hardenedFuses: true,
      developerIdSigned: true,
      signatureVerified: true,
      notarized: true,
      installerSigned: true,
      installerNotarized: true,
      gatekeeperAccepted: true,
      installerGatekeeperAccepted: true,
    };
    assert.doesNotThrow(() => assertTrustedMacRelease(ready));
    assert.throws(
      () => assertTrustedMacRelease({ ...ready, [missing]: false }),
      /No download package/,
    );
  });
test("loads the monorepo packaging file while keeping explicit environment values", () => {
  const directory = mkdtempSync(join(tmpdir(), "xuelearn-packaging-"));
  const previous = process.env.XUELEARN_PACKAGING_TEST;
  try {
    const host = join(directory, "desktop/apps/desktop");
    mkdirSync(host, { recursive: true });
    writeFileSync(
      join(directory, ".env.packaging"),
      "XUELEARN_PACKAGING_TEST=from-file\n",
    );
    delete process.env.XUELEARN_PACKAGING_TEST;
    assert.equal(loadPackagingEnv({ cwd: host }).loaded, true);
    assert.equal(process.env.XUELEARN_PACKAGING_TEST, "from-file");
    process.env.XUELEARN_PACKAGING_TEST = "explicit";
    loadPackagingEnv({ cwd: host });
    assert.equal(process.env.XUELEARN_PACKAGING_TEST, "explicit");
  } finally {
    if (previous === undefined) delete process.env.XUELEARN_PACKAGING_TEST;
    else process.env.XUELEARN_PACKAGING_TEST = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
