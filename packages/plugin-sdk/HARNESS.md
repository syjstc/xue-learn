# DeepSeek Harness apply compatibility

`@xue-learn/desktop-plugin-sdk/harness` provides a small **source-level** adapter
for function or object/ESM `apply` plugins that use common Cordis effects and
events. A plugin can run in the background and contribute an embedded React view through
the separate renderer contract. It must own cleanup for timers, listeners and
child processes. Legacy adapters may still launch an independent UI by command.

This is not a DeepSeek Harness package installer or complete Harness runtime.
Desktop supplies Cordis 4.0.0-rc.10 and `ctx.desktop`. The adapter rejects required
services that Desktop does not supply, class plugins, plugin-level
`provide`/`intercept` metadata and non-array injection declarations. Standard
Schema `Config` defaults and validation are retained; asynchronous validators
are unsupported, matching the reviewed upstream contract.

```ts
import * as upstream from './portable-harness-plugin.js';
import { adaptHarnessPlugin, inspectHarnessPlugin } from '@xue-learn/desktop-plugin-sdk/harness';

// Reports shape/dependency compatibility only; review runtime imports separately.
const compatibility = inspectHarnessPlugin(upstream);
if (!compatibility.compatible) throw Error(JSON.stringify(compatibility));

export default adaptHarnessPlugin(upstream, { config: { intervalMs: 1000 } });
```

Compile this entry and its non-Cordis dependencies into the Desktop package's
runtime JavaScript, then create the usual `plugin.json` with hashes. A background
plugin can declare `contributes.commands: []` and `requires: {}`. Its own Harness
configuration is supplied explicitly above; Desktop's installation paths and
manifest are never accidentally passed as the Harness config.

Do not bundle a second Cordis runtime or alias `@deepseek-ai/cordis` to `cordis`
and assume compatibility. A **type-only** Context import erases cleanly. A runtime
import of Harness `Service`, runtime symbols or other Harness services requires
porting and separate verification. The structural check cannot inspect an
imported module's dependency graph or prevent module initialization side effects.
Only import trusted packages after reviewing their dependencies.

For an independent UI, wrap the adapted plugin in an ordinary Desktop plugin
that registers the launch command and deactivation guard. A plugin that already
depends on the Harness web UI, RPC graph or slot services needs explicit service
adapters; a standalone-looking panel alone does not establish compatibility.

## Reviewed upstream examples and limits

Reviewed on 2026-10-10 against the official developer-preview repository:

- [Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md)
  describes function/object plugins, dependency injection and reversible effects.
- [Vendored framework manifest](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/README.md)
  documents the independent `@deepseek-ai/cordis` fork and its patches. Matching
  the `apply` shape does not establish full runtime compatibility.
- [Configuration resolver](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/cordis/src/fiber.ts)
  uses synchronous Standard Schema validation.
- [time-context](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/context/time-context/src/index.ts)
  has no UI, but depends on `agents` and `sessionProjections`. It is rejected by
  this adapter until those behaviors are explicitly ported.
- [HTTP fetch provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web-fetch-http/src/index.ts)
  depends on `web`; no such service is silently synthesized by Desktop.
- [Inspector](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/inspector/README.md)
  requires Harness host/client integration and is not directly supported.

Tests exercise a representative portable plugin on the actual Desktop Cordis
runtime: schema defaults, events, generator effects, returned disposers and
repeated activation/disposal. They also check explicit rejection of the official
examples' dependency shapes. These tests do **not** certify those upstream
packages or the full Harness distribution.
