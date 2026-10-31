# Security policy

Report suspected vulnerabilities privately to **contact@xue-learn.com**. Include affected versions, reproduction steps, and the security impact. Redact API keys, authentication tokens, learner content, and local file paths. Please avoid posting an exploitable issue or real credentials in a public issue.

Security fixes target the latest Desktop release and the current Core workspace. Older installers do not update automatically; install the current version to receive fixes.

## Local security model

- The app window uses renderer sandboxing and context isolation without Node integration. Native IPC checks the live app window, its main frame, and its exact local origin before granting capabilities.
- The local service listens on `127.0.0.1` and requires a random per-session bearer token. External clients require their own explicitly scoped workspace session.
- Provider credentials are stored through Electron's operating-system encryption facilities. They are passed to the local service as needed and are not included in source or release packages.
- Installed executable plugins can run native code with the user's account permissions. Process isolation supports lifecycle management; it is not an operating-system sandbox. Install only plugins you trust.
- Learning content and imported documents can be sent to configured AI, search, image, or speech providers when those features are used. See [privacy](docs/privacy.md).

## Verification

`pnpm run check:security` checks the tracked/distributable source, scans all reachable Git history plus the current source using Gitleaks, and queries the npm dependency advisory registry. Mac release packaging also checks required native resources, excludes local credentials, learner stores and debug assets, and verifies application/DMG signatures, notarization tickets, and Gatekeeper acceptance.

These checks cover known advisories and the configured source/package boundaries; they are not a guarantee against every vulnerability. Do not commit local audit output or credentials. Security checks never change GitHub visibility or publish a release.

See the [dependency review](docs/dependency-security.md) for the current lower-severity tooling reports and pinned compatibility fixes.
