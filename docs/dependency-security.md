# Dependency security review

The 0.3.1 dependency review on 2026-10-31 updated Electron, Forge, the PDF/image stack, routing, schema validation and vulnerable build dependencies. The locked workspace audit reports **zero high and zero critical advisories**. Run `pnpm audit --json` again when preparing a release; advisory results change over time.

Three lower-severity reports remain in development/test tooling:

| Package | Advisory | Scope and assessment |
| --- | --- | --- |
| `deepmerge@4.3.1` | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low | Used by Jest to merge repository-controlled test configuration. Upstream has no patched release. Do not run an untrusted test configuration with local credentials. |
| `minimatch@3.1.5` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate | Used by test discovery, coverage and installer build tooling. The advisory's broad version range includes this branch, while its described `firstPhasePreProcess` / `optimizationLevel >= 2` implementation is absent from version 3. |
| `minimatch@5.1.9` | Same advisory, moderate | Used by schema generation and installer build tooling. The described optimization implementation is also absent from version 5. Versions 9/10 in the newer packaging graph are overridden to patched version 11.0.3. |

These three package instances are not staged as runtime dependencies in the Mac application. The source CI continues to show all reports and fails on high/critical severity; no advisory IDs are globally suppressed.

`appdmg@0.6.6` expects the old callback form of `image-size`. The reviewed [compatibility patch](../patches/appdmg@0.6.6.patch) reads the background bytes and calls the current `imageSize` API so the DMG build can use patched `image-size@2.0.4`. The patch is part of pnpm's integrity-checked lockfile. `simple-git`, `tar`, `tmp`, `multer`, KaTeX and modern glob/minimatch dependencies are also pinned to patched versions through workspace overrides.

The release resource audit and actual package inspection remain necessary: a lockfile alone does not prove which dependencies and notices are in a binary.
