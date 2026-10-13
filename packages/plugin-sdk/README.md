# XueLearn Desktop Plugin SDK

The SDK supports embedded React views, trusted native composition and optional background workers. UI-only plugins run inside Desktop and reuse its React, UI components and Core capabilities. They need no worker, private API server or duplicate persistence configuration.

The root export contains browser-safe manifest validation and IPC contracts. The `./renderer` export supplies embedded view contracts. The `./cordis` export supplies worker authoring types and `ctx.desktop` augmentation. Cordis **4.0.0-rc.10** is an exact peer dependency for workers; the Desktop worker supplies one runtime instance. Do not bundle another Cordis instance or React runtime into a plugin.

The optional `./harness` export adapts the portable `apply` subset of DeepSeek Harness plugins. It preserves configuration validation and Cordis cleanup, and rejects missing Harness services before activation. This is source-level reuse, with the restrictions and packaging example in [HARNESS.md](./HARNESS.md).

Build a consumable package from the Desktop repository:

```sh
node scripts/build-plugin-sdk.mjs
npm pack ./packages/plugin-sdk --pack-destination /tmp
```

## Embedded views

An embedded module exports `createView(host)` and returns a React component. Desktop mounts it in its existing layout, with the host theme and providers. Declare an entry in `contributes.views`; omit `runtime` when the plugin has no background commands.

```json
{
  "schemaVersion": 1,
  "id": "org.example.courses",
  "name": "Courses",
  "version": "1.0.0",
  "apiVersion": 1,
  "requires": { "workspace.courses": 1 },
  "contributes": {
    "views": [{ "id": "courses", "title": "Courses", "entry": "view.mjs", "stylesheet": "view.css" }]
  },
  "integrity": {
    "view.mjs": "REPLACE_WITH_64_LOWERCASE_HEX_DIGITS",
    "view.css": "REPLACE_WITH_64_LOWERCASE_HEX_DIGITS"
  }
}
```

TypeScript authors can type the factory without importing a second runtime:

```ts
import type { DesktopPluginRendererModule } from '@xue-learn/desktop-plugin-sdk/renderer';

export const createView: DesktopPluginRendererModule['createView'] = (host) => {
  const { createElement: h, useEffect, useState } = host.React;
  const { Card, CardHeader, CardTitle, CardContent } = host.ui;
  return function Courses() {
    const [count, setCount] = useState<number | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
      let current = true;
      host.core.courseSource.catalog().then(rows => {
        if (current && !host.signal.aborted) setCount(rows.length);
      }).catch(error => {
        if (current && !host.signal.aborted) setError(String(error));
      });
      return () => { current = false; };
    }, []);
    return h(Card, null,
      h(CardHeader, null, h(CardTitle, null, 'Courses')),
      h(CardContent, null, error || (count === null ? 'Loading…' : `${count} lessons`)));
  };
};
```

The host context provides:

- `React`, `ReactDOM`, and `ReactDOMServer.renderToStaticMarkup`: shared host runtimes.
- `assetUrl(path)`: a verified package resource relative to the view entry directory.
- `ui`: `Button`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Input`, and `Badge`.
- `core.courseSource.catalog()` and `readUnit(unitId)`: typed wrappers for `workspace.courses@1`.
- `core.display.TeachingDisplay` and `InlineMathText`: existing Core display components.
- `call(capability, method, args)`: versioned host capability calls bound to this view's workspace.
- `execute(command, args)`: optional declared worker commands; `navigate(path)`: host navigation.
- `pluginId`, `viewId`, `workspaceId`, `signal`, and `onDispose(callback)`: identity and cleanup.

Bundle the browser module as ESM; use `host.React` and avoid unresolved imports of `react` or `react/jsx-runtime`. Ordinary DOM elements and custom CSS are supported. Prefix CSS selectors with a plugin-specific class because the document is shared. The host removes the stylesheet on disposal. React effects clean up component resources; `onDispose` cleans up resources owned by the factory. Leaving the view, switching workspace or disabling the plugin revokes its host-issued session and pending capability work.

The current embedded extension point is a dedicated plugin page at `/local/plugins/:pluginId/views/:viewId`; arbitrary slots in other learning screens are not implemented. Renderer code is trusted and shares the host document. It is not a sandbox for untrusted JavaScript.

## Optional workers

Use a worker for Node/native dependencies or independent background work. It is not required merely to contribute UI. TypeScript authors can use:

```ts
import type { DesktopCordisPlugin } from '@xue-learn/desktop-plugin-sdk/cordis';

const plugin: DesktopCordisPlugin = {
  name: 'workspace-inspector',
  inject: ['desktop'],
  apply(ctx) {
    ctx.effect(() => ctx.desktop.registerCommand('workspace.inspect', async (_args, invocation) => {
      const connection = await invocation.call('workspace.connection', 'get');
      return { workspaceId: invocation.workspaceId, connection };
    }));
  },
};
export default plugin;
```

Compile the worker to a self-contained `.cjs`, `.mjs`, or `.js` module before packaging. Workers are trusted local code running in separate processes; process isolation is not an operating-system sandbox. The optional runtime entry, views, declared capabilities, commands and every file digest belong in `plugin.json`. Imported packages remain disabled until the user enables them. Updates require disabling the current version first and must use a new version; installation never overwrites an installed version.

Commands receive the original workspace and a scoped capability caller. A caller expires when that command returns. Declare exact capability major versions in `requires`; a missing version prevents activation. Use `ctx.effect()` to own command registrations, listeners, timers, child processes and asynchronous teardown. Cordis v4 does **not** provide a built-in `ctx.on('dispose')` lifecycle event. Register a `ctx.desktop.beforeDeactivate()` guard to refuse shutdown while work is busy; teardown effect errors cannot reverse disposal.

## Host capabilities and examples

Declare exact capability major versions in `requires`. Neither renderer nor worker callers choose the owner or workspace for a request; Desktop supplies the authenticated workspace context.

| Capability | Methods | Purpose |
| --- | --- | --- |
| `workspace.courses@1` | `catalog()`, `readUnit({ unitId })` | Read the selected workspace's catalog and Core `course-source.v1` snapshots. A missing unit returns `null`. |
| `learning.preview@1` | `ensure({ unitId, locale? })` | Prepare only a missing preview in the selected workspace using the normal learning controller. Joins active work, retains accepted previews/material and returns `{ complete: true }` after the saved stream completes. Locale is `zh-Hans`, `zh-Hant` or `en`. Declare this capability separately from source reads. |
| `display.workspace@1` | `plugins()`, `resolveDocument({ document })`, `getBuild({ id })`, `retryBuild({ id })`, `cancelBuild({ id })` | Reuse host-configured display services and builds. A missing build read returns `null`. |
| `workspace.connection@1` | `get()` | Legacy worker adapter access to the workspace broker, used by the current separate Video application. |

`examples/plugins/course-browser` is a complete embedded UI-only plugin with no bundled React or runtime entry. `examples/plugins/workspace-inspector` is a small worker example. Regenerate both packages' hashes using `node scripts/build-example-plugin.mjs`, then install either directory from Desktop's plugin manager. Integrity uses SHA-256 of each file except `plugin.json`. Contained relative symlinks are supported and use SHA-256 of `symlink:` followed by the link target. Files not listed in integrity are rejected.

The current Video Studio package still opens a separate application; introducing this SDK does not migrate its UI, generation workflow or persistence. See [Desktop plugin architecture](../../docs/desktop-plugins.md) for the implemented boundary and migration direction.

`contributes.displayPackages` reserves compatibility with existing display package directories. A host must provide a complete activation/disposal adapter before enabling those contributions; the first host release rejects them rather than silently installing permanent display resources. Existing display plugins continue using their current loader.

## Native host mode

`runtime.mode: "host"` executes a trusted Cordis plugin in Electron main. It shares
the host process and must provide a hashed `runtime.json` with the exact Electron
version, OS and architecture used for native bindings. `ctx.desktop.native`
supplies long-lived workspace binding, verified resource surfaces and private
provider composition. These services are never exposed to renderer IPC.

Use `hidden: true` for commands called by an embedded view that need structured
arguments. The view can use split ESM chunks and package assets with integrity
hashes. Native code must guard active work with `beforeDeactivate` and register
cleanup through Cordis effects. Host mode is full main-process trust, not an
execution sandbox.
