# XueLearn Desktop

Independent public desktop learning application. Electron is the host technology; Desktop is the project name. Learning rules, shared services/displays and the workspace SDK come from the installed `@xue-learn/core@0.2.0` release. This repository has no copied Core library implementation.

Run `pnpm install --frozen-lockfile`, `pnpm run check:core`, `pnpm test`, then `pnpm build`. Use `pnpm dev` for development. The host is in `apps/desktop`, its service in `apps/local-runtime`, and its owned SQLite adapter in `persistence/sqlite`. Native dependency staging and signed installers are separate release steps.

The Core tarball and SHA-256 receipt are retained in this repository; no sibling Core checkout is needed. Core updates are explicit dependency/lockfile changes. Live learner workspaces are not relocated by the source split.

Owned source code is MIT. [Brand assets](BRAND_ASSETS.json) remain under the [separate noncommercial license](LICENSE-BRAND). See [license scope](LICENSING.md) for third-party and other media terms.
