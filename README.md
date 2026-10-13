# XueLearn Desktop

Independent public desktop learning application. Electron is the host technology; Desktop is the project name. Learning rules, shared services/displays and the workspace SDK come from a fixed `@xue-learn/core` release recorded in `core-dependency.v1.json`. This repository has no copied Core library implementation.

## Use the application

When a Desktop installer is published, install the version for your operating system and architecture. The installer includes the application, Core capabilities and its local service; users do not install Core, Node.js or pnpm separately. AI generation still requires a model service configured by the user.

## Run from source

Clone the complete Desktop repository, including `vendor/`. Install Node.js and pnpm `9.15.9`, then run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run check:core
pnpm dev
```

`pnpm dev` starts the renderer, local service and Electron. The lab runtime is disabled by default and does not open port 5177. To include the lab runtime for a development session, run `XUELEARN_DESKTOP_ENABLE_LAB=1 pnpm dev`.

Running `pnpm dev` again focuses the existing XueLearn window and exits successfully before starting any watchers. To apply Electron main/preload changes or recover from a stuck development process, run:

```sh
pnpm desktop:restart
```

`pnpm desktop:clean` stops this checkout's Electron instance, renderer/lab watchers, sidecar watcher and their children, then removes generated renderer, sidecar and Electron bundles and Vite caches. It sends SIGTERM, waits up to three seconds, then sends SIGKILL to processes that remain. This interrupts running development generation/export tasks; saved learner workspaces, the user profile, credentials, installed plugins and exports are preserved. `pnpm desktop:restart` runs cleanup and starts a fresh development session only if cleanup succeeds. A packaged application outside this checkout must be quit separately if it holds the same profile.

Use `pnpm desktop:stop` to stop processes while keeping generated output, or `pnpm desktop:clean --dry-run` to preview the exact process IDs and paths. These commands support macOS and Linux and require `ps` and `lsof`. Cleanup checks process ownership and start times, and refuses to stop an unrelated application merely because it occupies a development port. If a required port remains occupied, it reports the conflict and leaves generated files intact.

Core is installed from the release archive retained in this repository; no sibling Core checkout, npm publication of Core or separately deployed Core server is needed. Dependency installation must allow the native modules to build or install their platform binaries.

The host is in `apps/desktop`, its service in `apps/local-runtime`, and its owned SQLite adapter in `persistence/sqlite`. Live learner workspaces are not relocated by the source split.

## Desktop plugins

Open **Device settings → Desktop plugins** to install and manage local extensions.
The Cordis host runs each executable plugin in its own process; plugins add tools
and independent windows through versioned capabilities. Video Studio is the first
packaged extension, including its own rendering dependencies. See the
[plugin guide](docs/desktop-plugins.md) for installation, SDK usage, lifecycle and
the planned display compatibility adapter.

Build the standalone SDK with `pnpm build:plugin-sdk`; run plugin checks with
`pnpm test:plugins`. After building Desktop, `pnpm verify:plugins -- /path/to/video-plugin`
exercises the real Electron host and optional Video package in disposable profiles.

## Build an installer

```sh
pnpm run check:core
pnpm test
pnpm build
pnpm --dir apps/desktop run make
```

`pnpm build` compiles the application. `make` stages the local service and native dependencies, then creates the host platform's installer under `apps/desktop/out/`. Signing, notarization and installation checks on another machine are release steps; a successful source build alone does not verify an installer.

## Update Core

Maintainers choose a new Core release explicitly with `pnpm run core:pin -- /path/to/new-core.tgz`, reinstall dependencies to update the lockfile, and run Desktop's checks before releasing a new Desktop version. Core changes do not automatically change an installed application.

See [public distribution and Core update steps](docs/operations/public-desktop-product.md) for the complete workflow and the files that must be committed together. [Core API verification](docs/core-api-verification.md) records the existing source tests and build verification scope.

## License

Owned source code is MIT. [Brand assets](BRAND_ASSETS.json) remain under the [separate noncommercial license](LICENSE-BRAND). See [license scope](LICENSING.md) for third-party and other media terms.
