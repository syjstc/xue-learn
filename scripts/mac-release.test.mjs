import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  macNotaryArguments,
  assertTrustedMacRelease,
} from "./mac-release-config.mjs";
import { loadPackagingEnv } from "../desktop/apps/desktop/src/load-packaging-env.ts";

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
