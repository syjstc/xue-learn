import { basename } from "node:path";

export function assertReleaseVersions(versions) {
  if (!versions.length || !versions.every(version => /^\d+\.\d+\.\d+$/.test(version)))
    throw Error("Release versions must be stable major.minor.patch values.");
  if (!versions.every(version => version === versions[0]))
    throw Error("Workspace, Desktop and host release versions must match.");
}

export function macNotaryArguments(env) {
  if (env.APPLE_NOTARY_KEYCHAIN_PROFILE)
    return ["--keychain-profile", env.APPLE_NOTARY_KEYCHAIN_PROFILE];
  if (env.APPLE_API_KEY) {
    const keyId =
      env.APPLE_API_KEY_ID ||
      /^AuthKey_([A-Z0-9]+)\.p8$/.exec(basename(env.APPLE_API_KEY))?.[1];
    if (!keyId)
      throw Error("Set APPLE_API_KEY_ID for the existing Apple API key.");
    return [
      "--key",
      env.APPLE_API_KEY,
      "--key-id",
      keyId,
      ...(env.APPLE_API_ISSUER ? ["--issuer", env.APPLE_API_ISSUER] : []),
    ];
  }
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
    return [
      "--apple-id",
      env.APPLE_ID,
      "--password",
      env.APPLE_APP_SPECIFIC_PASSWORD,
      "--team-id",
      env.APPLE_TEAM_ID,
    ];
  throw Error(
    "Mac releases require Apple notarization credentials: an existing keychain profile, API key, or Apple ID/app-specific password/team.",
  );
}

export function assertTrustedMacRelease(status) {
  for (const field of [
    "hardenedFuses",
    "developerIdSigned",
    "signatureVerified",
    "notarized",
    "installerSigned",
    "installerNotarized",
    "gatekeeperAccepted",
    "installerGatekeeperAccepted",
  ]) {
    if (status[field] !== true)
      throw Error(
        `Mac release verification failed: ${field}. No download package was exported.`,
      );
  }
}
