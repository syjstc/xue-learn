# Desktop plugins

Desktop is the plugin host. Core continues to own the learning domain and shared
display protocols. Plugins can contribute custom React views **inside Desktop**,
using the host's React instance, UI components and workspace capabilities. A
UI-only plugin needs no backend, API server, worker or separate application.

Plugins can also declare `contributes.ui` with named placements: lesson-title
actions, lesson-body actions, inline lesson panels and settings tabs. Desktop
renders action controls and navigation, resolves encoded course context and
mounts custom panels through the same verified renderer session. The
`ui.extensions@1` capability gates compatibility. The [SDK placement contract](../packages/plugin-sdk/README.md#ui-placements)
contains manifest examples and the supported slot catalog.

Video Studio 0.2.11 uses `unit.content.actions` to open the current lesson's
saved video editor and `settings.tabs` to expose export preferences. Chat,
reading and immersive body presentations share the placement. The full learning
return path is carried with the view. Disabling a plugin removes its placements;
unavailable settings tabs resolve back to the profile tab after the registry
has loaded. No video-specific IDs appear in the host's learning/settings UI.

A plugin may additionally declare `runtime.mode: "host"` for trusted native and
background work inside Desktop main, or `runtime.mode: "worker"` (the default)
for an isolated utility process. Video Studio uses host mode. Renderer and native
contracts are separate, so a simple UI tool needs no native runtime.

This implementation uses **Cordis 4.0.0-rc.10** for host service registration and
plugin lifecycles. Desktop supplies package validation, embedded view mounting,
host or worker runtimes, workspace binding, IPC and the management UI.

See [the security model](../../SECURITY.md) before installing executable plugins.

## Install, enable, update and remove

Open **Device settings → Desktop plugins** (`/local/plugins`). Select **Install
local plugin** and choose a directory containing `plugin.json` and the package
files. Installation copies the package into Desktop's plugin store, verifies its
inventory, and leaves it disabled.

On first use, the embedding setup screen also provides **Manage desktop plugins**.
This route is available before a model is configured; learning and other settings
routes still require embedding setup.

Review the plugin's name, version, capabilities and source before enabling it.
Embedded views are trusted JavaScript in the host renderer; the capability
contract is not a sandbox for hostile renderer code. Host mode has full Electron
main-process trust, including native libraries and private provider composition;
it does not isolate a crashing native extension from Desktop. A worker has Node access
under the current OS user: process isolation protects the host's lifecycle but
is **not an OS security sandbox**. Use trusted packages. SHA-256 checks detect
changed or damaged files; they do not authenticate a publisher.

When enabled, the plugin's declared views and visible commands appear as actions on its
card. An embedded view opens inside Desktop's existing layout; a command-backed
view still runs its declared command. Required capabilities are checked before
activation; failures appear on the card. An existing enabled plugin is restored
on the next Desktop launch. Worker failures do not prevent the learning
application from starting.

For an update, first finish or pause the plugin's work, disable it, and install a
package with the same ID and a new version. Versions are immutable: a package
cannot overwrite an already installed version. Updates are installed disabled
and require another enable action. The package store retains older versions;
there is currently no automatic update feed or rollback UI. Plugin data
migrations belong to the plugin and must be designed separately from code
updates.

Disable unmounts embedded views, revokes their capability sessions, and stops
any worker and its Cordis registrations. Running commands and plugin
deactivation guards can refuse the operation to protect unfinished work. Remove
is available after disabling and deletes package files and the registry entry.
It preserves the plugin's data directory and independently managed Video
projects.

## Boundaries and data ownership

```text
Desktop renderer
  ├─ host navigation, React, shared UI and Core display components
  └─ embedded plugin view: createView(host), no extra process
       ↓ host-issued view session, scoped to the selected workspace
Desktop main: package store, sessions, Cordis host capabilities
  ├─ workspace.courses → host-owned course persistence
  ├─ display.workspace → host-owned display services
  ├─ generation.settings → owning workspace model and generation settings
  ├─ host-mode plugin: in-process Cordis commands, native jobs, verified assets
  └─ optional plugin utility process: Cordis commands and effects
```

The SDK has four entry points:

- `packages/plugin-sdk/src/index.ts`: browser-safe manifest, status, wire protocol
  and validation contracts.
- `packages/plugin-sdk/src/cordis.ts`: authoring types for commands, configuration
  and Cordis's `ctx.desktop` service.
- `packages/plugin-sdk/src/renderer.ts`: host-provided React, shared UI, Core
  display components and the embedded view context.
- `packages/plugin-sdk/src/harness.ts`: a limited source-level adapter for
  portable DeepSeek Harness apply plugins.

These are Desktop-owned contracts and do not change Core's runtime bridge.
The management bridge is `window.xueLearnPlugins`; Core's
`window.xueLearnDesktop` remains separate.

Desktop stores installed code and retained plugin data under its `userData`
directory:

```text
plugins/
  registry.json
  packages/<plugin-id>/<version>/
  data/<plugin-id>/
```

`configuration.pluginRoot` points to the installed package and
`configuration.storagePath` to `data/<plugin-id>`. Plugins should treat package
files as immutable. The data directory is plugin-wide; workspace-specific state
must additionally use `invocation.workspaceId`. Learning databases remain owned
by their workspace services. Embedded plugins call host capabilities instead of
opening databases, configuring another persistence layer, or implementing a
duplicate API server. They do not import Desktop's private persistence modules.

## Package manifest

The following is a minimal manifest. Replace the digest with the actual SHA-256
of `plugin.cjs` before installation.

```json
{
  "schemaVersion": 1,
  "id": "org.example.workspace-tool",
  "name": "Workspace tool",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "An example workspace-aware tool.",
  "runtime": { "entry": "plugin.cjs" },
  "requires": { "workspace.connection": 1 },
  "contributes": {
    "commands": [{ "id": "workspace.record", "title": "Record workspace" }],
    "views": [
      { "id": "tool", "title": "Workspace tool", "command": "workspace.record" }
    ]
  },
  "integrity": {
    "plugin.cjs": "REPLACE_WITH_64_LOWERCASE_HEX_DIGITS"
  }
}
```

IDs use lowercase letters, digits, dots and hyphens, beginning with a letter.
Versions use semantic versioning. `apiVersion` identifies the Desktop plugin
protocol; values in `requires` are exact major capability versions. Both are
checked during installation or activation. Command IDs must be declared and
unique. A view has exactly one of `command` (a declared command) or `entry`
(an embedded ES module). An embedded view may additionally specify a package
`stylesheet`. All entry and stylesheet files must appear in `integrity`.
Commands require a `runtime`; embedded views do not. Set `hidden: true` on
commands used only by embedded views so they do not appear as empty-argument
actions in the manager. Split renderer chunks, styles, fonts and other resources
are served from the entry directory after integrity checks.

Every package file other than `plugin.json` must appear in `integrity`. Internal
relative symlinks are permitted for native application bundles; their digest is
the SHA-256 of the UTF-8 string `symlink:` followed by the link's target text.
Absolute, broken and package-escaping links are rejected. Installation verifies
the source and staged copy; activation rechecks the installed package. The
package limit is 100,000 entries and 4 GiB of regular files.

Bundle plugin-owned browser dependencies into the embedded module. Use the
host's React, UI and exposed Core components instead of bundling second copies.
Workers must ship compatible native dependencies for each target platform and
architecture. The host never runs an install script or downloads dependencies
on activation.

## Author an embedded view

`examples/plugins/course-browser` is a complete UI-only plugin. Build its hashes
with `node scripts/build-example-plugin.mjs`, install that directory, enable it,
and open **课程浏览器**. It reads the current workspace's catalog and saved
course sections using shared host buttons, cards, inputs and Core's inline math
renderer. It has no runtime entry and starts no process.

```json
{
  "schemaVersion": 1,
  "id": "org.example.course-browser",
  "name": "Course browser",
  "version": "1.0.0",
  "apiVersion": 1,
  "requires": { "workspace.courses": 1 },
  "contributes": {
    "views": [{ "id": "courses", "title": "Courses", "entry": "view.mjs" }]
  },
  "integrity": { "view.mjs": "REPLACE_WITH_64_LOWERCASE_HEX_DIGITS" }
}
```

An embedded ES module exports `createView(host)`, which returns a React component:

```js
export function createView(host) {
  const { createElement: h, useEffect, useState } = host.React;
  const { Card, CardHeader, CardTitle, CardContent } = host.ui;
  return function CourseList() {
    const [rows, setRows] = useState([]);
    const [error, setError] = useState('');
    useEffect(() => {
      let current = true;
      host.core.courseSource.catalog().then(result => {
        if (current && !host.signal.aborted) setRows(result);
      }).catch(error => {
        if (current && !host.signal.aborted) setError(String(error));
      });
      return () => { current = false; };
    }, []);
    return h(Card, null,
      h(CardHeader, null, h(CardTitle, null, 'Courses')),
      h(CardContent, null,
        error ? h('p', { role: 'alert' }, error) : rows.map(row =>
          h('p', { key: row.unitId }, row.title))));
  };
}
```

Use `host.React` for hooks and element creation. JSX builds must use that same
instance: avoid an emitted import of `react/jsx-runtime` that the installed
module cannot resolve, or a bundled React runtime. A bundled browser module with
`React.createElement` and `const React = host.React` is one straightforward
option. The shipped example is plain ESM and needs no bundler.

`host.ui` exposes `Button`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`,
`CardContent`, `Input` and `Badge`. `host.core.display` exposes
`TeachingDisplay` and `InlineMathText` from the host's existing Core renderer.
These are curated public component surfaces; plugin code can compose custom
layouts and ordinary browser elements without reaching into Desktop internals.
Prefix CSS selectors with a plugin-specific class because styles share the
renderer document.

`host.call(capability, method, args)` uses an opaque, host-issued view session.
The workspace comes from that session, not from IDs or URLs supplied by the
plugin. Declare each used capability and its exact major version in `requires`.
`host.core.courseSource.catalog()` and `readUnit(unitId)` are convenience wrappers
over `workspace.courses@1`; `host.call` is the generic versioned extension point.
The catalog is an array of rows containing `unitId`, `title`, `goalTitle`,
`moduleTitle`, `spaceName` and ordering metadata. `readUnit` returns Core's
`course-source.v1` snapshot with `metadata`, `sections`, `preview` and assets,
or `null` when the requested unit no longer exists.

For display preparation, declare `display.workspace@1` and call `plugins()`,
`resolveDocument({ document })`, `getBuild({ id })`, `retryBuild({ id })` or
`cancelBuild({ id })` through `host.call`. These reuse the owning workspace's
configured display services; `getBuild` returns `null` for a missing build.

The view context also includes plugin/view/workspace IDs, host navigation,
declared worker command execution, an abort signal and disposal callbacks.
Views may own internal navigation, such as a private memory router. Desktop marks
the mounted content with `data-desktop-plugin-content`, so its learning-progress
link guard does not capture those links. Use `host.navigate(path)` to open a
Desktop page; the host's Back to plugins link remains outside this boundary.
React effect cleanup remains the right place for component-owned listeners and
timers. Use `host.onDispose()` for resources created by `createView()` itself.
Leaving the view, switching workspace or disabling its plugin invalidates the
view session; late capability calls cannot retain access to the old workspace.
The example also ignores stale responses when the learner selects a different
course while an earlier read is still in flight.

The plugin **does** define its manifest and optional private feature logic. It
does **not** need to define an API for existing host functions. Desktop owns the
versioned capability implementations and persistence configuration. New shared
functions should first become a host capability or SDK component, then be reused
by plugins.

## Author a Cordis plugin

The JavaScript entry exports a Cordis plugin. A CommonJS example:

```js
const { writeFile } = require("node:fs/promises");
const { join } = require("node:path");

module.exports = {
  name: "workspace-tool",
  inject: ["desktop"],
  apply(ctx, configuration) {
    let pendingWork = 0;

    ctx.effect(() =>
      ctx.desktop.registerCommand(
        "workspace.record",
        async (_args, invocation) => {
          pendingWork++;
          try {
            // The host binds this call to the workspace selected when the
            // command began. The plugin cannot choose a different workspace.
            await invocation.call("workspace.connection", "get");
            await writeFile(
              join(configuration.storagePath, "last-workspace.json"),
              JSON.stringify({ workspaceId: invocation.workspaceId }),
              { mode: 0o600 },
            );
          } finally {
            pendingWork--;
          }
        },
      ),
    );

    ctx.effect(() =>
      ctx.desktop.beforeDeactivate(() => {
        if (pendingWork) throw new Error("Finish the current operation first.");
      }),
    );
  },
};
```

Use `ctx.effect` to own registrations and cleanup. The deactivation guard runs
before Cordis begins disposing resources. For a child application, the guard
should ask that application to stop through its normal save/close flow and
refuse while unfinished work cannot be safely suspended. Add cleanup for child
processes, listeners and timers as Cordis effects.

`invocation.call()` is valid only while the command is running. The host checks
that the capability was declared and that its version is available, then uses
the original workspace binding. Calls after command completion are rejected;
unawaited capability requests are cancelled. Renderer-supplied arguments do not
override the host's workspace identity. Capability providers receive an
`AbortSignal` and should pass it to cancellable work.

The legacy `workspace.connection@1` capability, method `get`, returns the selected
`workspaceId` and workspace broker path. Video exchanges that connection for a
session with its existing workspace client protocol. Embedded views can use the
higher-level `workspace.courses@1` capability directly. Additional Core/Desktop
functionality can be exposed behind versioned capability adapters without
requiring a plugin to import internal host modules.

Activation and disposal default to 15-second timeouts; a command defaults to
120 seconds. The worker permits up to four concurrent commands. A long export
should therefore run as a resumable task in the plugin's own application or
service, with a short launch command and a deactivation guard. This version does
not introduce a generic host task queue or task migration protocol.

## Video Studio

Video currently remains a **legacy application adapter**, not a migrated embedded
view. Its adapter runs in the Cordis worker and opens Video Studio in its own
native window and separate Electron process.
The package carries its matching Chromium/Node runtime, SQLite binding,
rendering dependencies and FFmpeg. Desktop does not resolve Video's dependencies
or import source from the Video repository.

Build and package from the Video checkout:

```sh
pnpm run build
pnpm run package:plugin
```

Install the generated `release/video-plugin-VERSION-PLATFORM-ARCH` directory in
Desktop. Package generation is specific to the build machine's platform and
architecture. The Video repository's `plugin/README.md` documents packaging,
native dependency checks and release signing requirements.

The embedded view SDK and course-browser example do not migrate Video's screens,
generation orchestration, persistence adapters or export jobs. A future Video
migration should move its UI into a contributed view, call host services for
learning content and shared display preparation, and retain a worker only where
rendering or native dependencies require it. Installing this SDK alone does not
repair the standalone Video application's persistence configuration.

Video 0.2 retains the existing project library and queue when its saved source
workspace matches the selected host workspace. A different source workspace uses
its own plugin data directory. Model preferences, account authentication and
credentials come from Desktop. Close the legacy Video application before opening
the same library in the plugin; concurrent database ownership is refused.

## Display compatibility and future extraction

### DeepSeek Harness compatibility

The SDK's `./harness` export can reuse plain function/object `apply` plugins that
have no Harness service dependencies. It uses Desktop's real Cordis lifecycle
and retains synchronous Standard Schema configuration defaults and errors. Both
background plugins and plugins owning separate UI processes can use this path;
the UI process must have reversible cleanup and a Desktop launch command when
appropriate. Package the result using Desktop's manifest and integrity format.

```ts
import * as upstream from './portable-harness-plugin.js';
import { adaptHarnessPlugin } from '@xue-learn/desktop-plugin-sdk/harness';
export default adaptHarnessPlugin(upstream, { config: {} });
```

This is a portable source subset, not general npm/profile compatibility. The
[official Harness framework manifest](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/README.md)
documents a separate `@deepseek-ai/cordis` fork. Runtime Service subclasses and
Harness host/client graphs cannot be assumed compatible with Desktop's Cordis.
Even the no-UI [time-context plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/time-context/src/index.ts)
requires `agents` and `sessionProjections`; the
[Inspector UI](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/inspector/README.md)
requires Harness host/client services. The adapter rejects their missing service
dependencies explicitly. No complete official Harness plugin package has been
certified here. See [the SDK compatibility guide](../packages/plugin-sdk/HARNESS.md)
for authoring requirements, reviewed sources and verified behavior.

### Existing display packages

The existing `/local/display-plugins` manager remains available from the Desktop
plugin page. Existing display packages and saved learning content are unchanged.

The manifest reserves `contributes.displayPackages`, an array of package-relative
directories, and the worker manager accepts a reversible
`registerContributions` adapter. The initial Desktop composition does not yet
provide this adapter, so a Desktop plugin that declares display packages fails
activation with an explicit adapter error. It is not silently treated as
success. Existing display packages continue to be installed through their
existing manager.

A later adapter can register these packages with the existing Core display
workspace and dispose their contributions on disable, preserving one display
protocol. Future extraction should retain versioned public capability contracts,
plugin-owned data migration, reversible registrations and crash isolation.
Marketplace distribution, publisher signatures, sandboxing for untrusted code,
automatic upgrades and host task queues remain separate follow-up capabilities.
Renderer integration uses dedicated plugin pages and the named UI slots listed
in the SDK. Additional screens can add explicit slots without arbitrary DOM
injection or plugin patches to learning components.

## Trusted native composition

Host-mode packages declare `runtime: {entry: "plugin.cjs", mode: "host"}`. A
hashed `runtime.json` records platform, architecture and exact Electron version;
Desktop checks these before loading native code. The package carries its native
dependencies, not another Electron distribution. Cordis exposes
`ctx.desktop.native` only to this runtime:

- `bindWorkspace(id)` supplies the host owner, declared capability calls and a
  plugin-lifetime abort signal, allowing saved jobs to outlive an open view.
- `createSurface({workspaceId, root, request})` serves verified package files and
  in-process media/application requests through `xuelearn-plugin:`. No Video
  port, listener, authentication token or second API server is created.
- `getAIEnvironment()` and `codexToken()` compose providers in main. They must
  never be included in command responses or renderer state.

Video keeps its project revisions, audio, display build checkpoints and export
queue; learning content stays owned by the workspace service. It uses the host's
model/account configuration and display package catalog. Rendering an MP4 can
create temporary hidden capture windows, which are released after the export.
The editor itself uses Desktop's existing window and React tree.
