# Shared display plugins

Desktop learning and Video render the same `DisplayDocument` through `DisplayRuntimeSurface`. Video owns the frame clock, captions and export; Desktop owns playback controls, learning progress and interaction. The shared artwork comes from the animated Video components. Core has no dependency on Remotion, Electron, a database or a host API.

## Public entries

- `@xue-learn/core/display/runtime`: document types, exact-version catalog, resource preparation, clock, isolated rendering and placeholders.
- `@xue-learn/core/display/catalog`: serializable builtin manifests and compatibility adapters. Generators and servers can import this without React.
- `@xue-learn/core/display/plugins`: the lazy-loaded builtin animation modules. Each domain loads its own renderer module.
- `@xue-learn/core/display/sampling`: pure animation timing and geometry without React or browser assets.
- `@xue-learn/core/display/film`: compatibility exports for the shared film artwork; application hosts should normally render documents through the runtime.
- `@xue-learn/core/display/workspace`: plugin manager, workspace provider and durable-build polling. Import `display/runtime.css`, `display/plugins.css` and `display/workspace.css` in hosts.
- `@xue-learn/core/server/display-workspace`: persistent plugin installation and background builds. Hosts start and stop this service with their workspace.

## Author and share a domain package

Import `acoustics.plugin.json` in the **展示插件** page in either application. Its `acoustics:chord-ratio` component combines the math formula board and playable music score. `acoustics.display.json` is a complete example document; the same document can be used in a course and video. A package can contain many components and exact-version dependencies across domains. The manager exports the manifest for sharing, with a content integrity hash.

Public imported packages are declarative JSON. A `composition` contains the same nodes used by authored documents. Read payload values with `{"$display":"payload","path":"score"}`. Insert caller-authored children with a `display:slot` node whose payload is `{"name":"children"}`; named slots must declare their cardinality and accepted component kinds in the component manifest. Node IDs in templates are scoped by the instance ID. Bindings read JSON fields only.

An installed version is immutable. Change the package version when editing it. Disabling a package removes it from model discovery while retaining it for previously generated courses. Trusted executable modules and builders are application integrations registered by the host, not JavaScript downloaded from a manifest URL.

## Generation and composition

The authoring catalog contains exact plugin/component versions, descriptions, schemas, examples, dependencies and available builders. The model emits a `display` block containing a document, or a `display_build` intent for a registered complex builder. Documents pin every required plugin; components can compose children from other installed plugins. Timeline cues refer to stable `nodeId/target` identities. A renderer is never allowed to start generation.

`math:derive` creates a `math:derivation` display. Its durable job is persisted before the ordinary section continues. A pending component renders a preparation placeholder; successful output replaces its payload through an owner- and source-revision-checked projection. Retry and cancellation reuse the stored job, checkpoints survive restart, and workers use leases and compare-and-swap writes. Existing saved derivation sections are read-compatible and use the same shared formula artwork.

## Rendering contract

Hosts supply an absolute clock with frame, FPS, tick rate and play state. Renderers sample this clock rather than advancing private timers. Seeking backward and exporting the same tick must reconstruct the same visual state. Interactive state is kept separately and cannot affect video-mode rendering.

Modules load once per exact installed version. Required resources are prepared and decoded before rendering; integrity failures are explicit. Invalid data, unavailable versions, failed resources, failed builds and renderer exceptions produce bounded placeholders with the affected component and reason. Failure in one child does not remove valid siblings. Video preparation waits for pending work and rejects unresolved failures instead of exporting an empty frame.

Resources follow component nesting: document resources provide defaults, a package's resources pass into its composed children, and the nearest package wins when IDs collide. Sibling scopes stay independent; duplicate IDs within one document or manifest are invalid. Renderers receive the prepared resource values, including verified image URIs.

Resource URLs must also satisfy the host's Content Security Policy. Desktop currently permits its local/same-origin resources and only the inline or blob formats allowed for that resource type; importing a package does not enable arbitrary HTTPS image or fetch origins. Use host-served assets for portable Desktop packages. Hosts retain control of their resource policy.
