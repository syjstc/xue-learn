# XueLearn Core

Public learning library under `core/` in the XueLearn monorepo. Desktop is developed alongside Core; private product repositories consume fixed, integrity-checked release artifacts.

Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build` and `pnpm pack`. The build emits JavaScript, TypeScript declarations and an integrity manifest. Browser/display entries reject Node APIs; Node services and the workspace connection SDK have separate entries. No desktop host, SQL driver or private product is included.

Import public capabilities by name:

```ts
import type {RuntimeDescriptor} from "@xue-learn/core/runtime-contracts";
import {configureClientRuntime} from "@xue-learn/core/client-runtime";
import {useI18n} from "@xue-learn/core/i18n";
import {Button} from "@xue-learn/core/ui/button";
import {createDisplayRegistry, DisplaySurface} from "@xue-learn/core/display/extensions";
```

Compiled entries are `/browser` (also the package root), `/display`, `/node`, `/workspace-client`, and `/display/extensions`. `/display` is a browser-bundler entry with CSS dependencies. Capability subpaths such as `/domain`, `/server/agenda/queries`, `/i18n`, and `/ui/button` preserve TypeScript sources for decorator-aware host bundling and shared runtime state. Every supported TypeScript entry supplies declarations and supports modern and legacy TypeScript package resolution. Internal directory names and file extensions do not belong in application imports.

See [public API and migration guide](docs/public-api.md) for entry selection, host requirements, state identity and verification. Consumer projects install a fixed release artifact, never a sibling checkout. Publishing metadata is enabled; no registry publication is performed by this split.

Desktop and Video share the domain-based display runtime in `/display/runtime`, `/display/catalog`, `/display/plugins` and `/display/workspace`. The same document and absolute clock drive learning previews and video frames; domain renderers load dynamically. See [display plugin authoring](docs/display-plugins/README.md) for publishing declarative packages, cross-domain composition and durable asynchronous component generation.

Owned code is MIT. No brand image is included in this package; the brand policy still covers use of the project name. See [license scope](LICENSING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
