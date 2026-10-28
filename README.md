# XueLearn public monorepo

This repository contains the open source XueLearn learning library (`core/`) and Electron application (`desktop/`). Their Git histories were imported intact. Video Studio, Game and Platform remain separate private products.

Core and Desktop keep separate package manifests and lockfiles. Desktop pins an integrity-checked Core package so its release build is reproducible; the two packages can now change in one Git commit and be checked together.

## Develop

Use Node.js and pnpm `9.15.9` or a compatible pnpm version:

```sh
pnpm run setup
pnpm run check
pnpm run dev
```

`pnpm run check` builds and tests Core, verifies Desktop's pinned Core, then tests Desktop and builds its renderer and local service. It does not package the application. For a smaller loop, use `pnpm run test:core`, `pnpm run test:desktop`, or the individual build scripts.

When Core changes must be consumed by Desktop, assign a new version in `core/package.json` and run:

```sh
pnpm run sync:core
pnpm run check
```

`sync:core` packs the current Core source, pins that archive in Desktop, updates Desktop's lockfile and verifies the installed package. Commit the Core version, Desktop manifest/lock/receipt and newly pinned archive together. A version already pinned to different bytes is rejected. Private products still consume explicit Core releases; no workspace source link is introduced into their builds.

See [Core](core/README.md) and [Desktop](desktop/README.md) for component setup and architecture. The [license scope](LICENSING.md) explains the MIT code grant and separate brand/media terms.
