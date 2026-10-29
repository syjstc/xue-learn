# XueLearn public monorepo

This repository contains the open source XueLearn learning library (`core/`) and Electron application (`desktop/`). Their Git histories were imported intact. Video Studio, Game and Platform remain separate private products.

Core and Desktop share one pnpm workspace and one lockfile. Desktop uses `workspace:*` to resolve the Core source in this repository. Every Desktop check, test, development start and full build rebuilds Core first, so a Desktop change uses the current Core without a separate version bump or archive pin.

## Develop

Use Node.js and pnpm `9.15.9` or a compatible pnpm version from the repository root:

```sh
pnpm run setup
pnpm run check
pnpm run dev
```

`pnpm run check` builds and tests Core, verifies Desktop's workspace link, then tests Desktop and builds its renderer and local service. It does not package the application. For a smaller loop, use `pnpm run test:core`, `pnpm run test:desktop`, or the individual build scripts.

After changing Core, run the normal workspace checks:

```sh
pnpm run check
```

Desktop resolves the current `core/` directory. `pnpm run dev` also rebuilds Core when its source changes. Core's package version changes when publishing a release for other consumers, not for each Desktop edit. Private Video, Game and Platform products continue to consume explicit Core releases; installed Desktop applications receive Core changes through a new Desktop release.

See [Core](core/README.md) and [Desktop](desktop/README.md) for component setup and architecture. The [license scope](LICENSING.md) explains the MIT code grant and separate brand/media terms.
