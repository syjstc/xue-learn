# XueLearn Core

Independent public learning library, version 0.2.0. Desktop, Video, Game and Platform consume the same versioned package.

Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build` and `pnpm pack`. The build emits JavaScript, TypeScript declarations and an integrity manifest. Browser/display entries reject Node APIs; Node services and the workspace connection SDK have separate entries. No desktop host, SQL driver or private product is included.

Entry points: `@xue-learn/core/browser`, `/display`, `/node`, `/workspace-client` and `/display.css`. Versioned source subpaths support decorator-aware host bundling and editor tooling. Consumer projects install a fixed release artifact, never a sibling checkout. Publishing metadata is enabled; no registry publication is performed by this split.

Owned code is MIT. No brand image is included in this package; the brand policy still covers use of the project name. See [license scope](LICENSING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
