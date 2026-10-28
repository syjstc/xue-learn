# Desktop plugin verification — 2026-10-10

Verified on macOS arm64, Electron 37.10.3 and Cordis 4.0.0-rc.10.

## Embedded Video 0.2 acceptance

Video Studio now contributes an embedded React view and runs its trusted native
Cordis module inside Desktop main. The final package is
`../xue-learn-video/release/video-plugin-0.2.0-darwin-arm64-final` (178 MB,
613 inventoried files). It contains no Electron distribution and no Video HTTP
server. Its SQLite binding is checked against Electron ABI 136.

After building Desktop's renderer, native host and local service, run:

```sh
node scripts/verify-video-embedded.mjs \
  ../xue-learn-video/release/video-plugin-0.2.0-darwin-arm64-final \
  artifacts/video-embedded-saved-project-2026-10-10
```

The test uses an isolated profile and the real migrated learning schema. It
installs and enables the complete package, reads a synthetic course through the
owning workspace, navigates into the embedded editor, returns to the course,
opens the host's model/account settings, and disables/re-enables the plugin.
It verifies host generation settings, complete course snapshots, the shared
display catalog and the persisted Video queue. A saved synthetic project also
loads four narration beats, the formula derivation preview, character assets,
fonts and playable audio. A TTS preference changed through the UI persists,
while the original saved revision and accepted display narration remain intact.
All ten checks passed, with no page exceptions or plugin resource failures.
Before and after Video activation, the BrowserWindow and every
Electron process ID are identical, including the existing local service.

Evidence: `artifacts/video-embedded-saved-project-2026-10-10/report.json`,
`video-library.png`, `video-unit-editor.png`, and `video-host-settings.png`.
The screenshots show the actual host sidebar and Video UI in the same window.
The HTML and Electron response CSP both allow the verified plugin protocol;
a regression test checks their resource policies remain consistent.

## Real MP4 export

From the Video checkout:

```sh
node scripts/verify-embedded-plugin-export.mjs \
  release/video-plugin-0.2.0-darwin-arm64-final \
  artifacts/embedded-plugin-export-final-2026-10-10
```

The packaged native module exported a real 1280 × 720 MP4 at 60 fps: 7.3 seconds,
438 frames, four narration clips. Its fixture uses accepted math display content
and tone audio, so no paid provider is invoked. The Electron harness forbids HTTP
listeners and confirms zero editor windows, one temporary hidden capture window,
and zero remaining windows/protocol surfaces after cleanup. The equation,
Chinese captions and character assets were visually reviewed in `frame-proof.png`.

Evidence in the Video checkout:
`artifacts/embedded-plugin-export-final-2026-10-10/report.json`, `native.json`,
`export.json`, and the generated MP4 path recorded there.

## Source and build checks

- Desktop plugin/SDK/UI tests: 15 suites, 118 tests passed.
- Desktop generation-settings, course-asset and display capability checks: 40
  tests passed.
- Video native/application/export/queue focused suite: 6 suites, 59 tests passed.
- Video dispatcher/storage/source focused checks: 28 tests passed; standalone
  HTTP/SSE transport checks: 3 passed.
- Embedded renderer checks: 22 source tests and 10 built-bundle browser checks
  passed. They cover host React/UI reuse, router isolation, CSS scoping, settings
  navigation, transport cancellation and disposal.
- Desktop renderer/native/local-service, SDK, Video renderer/native/plugin builds
  passed. Video pins verified Core 0.3.3; Desktop retains its verified Core 0.3.0.
- Core's host environment tests pass. Credential and local-runtime reads use a
  configured environment source without writing secrets to the host process
  environment.

The test groups overlap; their counts should not be added as a unique total.

## UI-only and worker coverage

The existing course-browser UI-only package remains supported and creates no
native runtime. Its twelve real Desktop acceptance checks passed again under
`artifacts/embedded-plugins-native-2026-10-10-r2`. Worker fixtures continue to
cover Cordis cleanup, crash isolation, scoped capabilities, immutable packages
and the documented portable Harness apply subset.

Earlier `verify-desktop-plugins.mjs` Video checks and Video's `verify-plugin*.mjs`
expect the old 0.1 standalone adapter. Their reports are legacy evidence, not
validation of the new 0.2 package.

## Practical limits

This verifies synthetic isolated projects, not regeneration of the user's saved
courses with live model/image/TTS providers. Existing Video projects are retained
in place when their saved source-workspace binding matches. The legacy Video
application must be closed before that library can be opened by the plugin;
concurrent writers are rejected. Existing provider secrets stay owned by Desktop.

Builds do not replace an already running Desktop. Restart the rebuilt host, then
install/enable the final 0.2 plugin package. Release signing/notarization, other
machines and other operating systems were not part of this acceptance. Trusted
host-mode native code shares Desktop's crash/failure boundary; it is not a sandbox.
