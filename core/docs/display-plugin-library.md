# Display plugin library

The shared `DisplayPluginManager` offers preview cards, readable component names,
search, domain filters and a component detail view. Desktop and standalone Video
use the same Core component. Embedded Video opens the host workspace library.

Every built-in component has an example rendered by the production Display runtime.
The library includes all 6 built-in packages and 27 components. Imported declarative
plugins use their manifest examples and exact package/dependency versions. A plugin
without examples offers a local JSON example loader; previews do not start generation
or alter saved course content. Disabled imported plugins remain previewable.

The detail view provides plugin/component navigation, previous/next controls, example
switching and a player with pause, restart and seeking. Interactive music retains its
score playback controls. Technical identifiers and definition export are available
in the expandable information section.

Hosts pass a controlled `selection` and `onSelectionChange` to the manager. Use
`readDisplayPluginSelection` and `writeDisplayPluginSelection` with router search
parameters to support reloads, links and browser history without discarding unrelated
host query parameters. The default uncontrolled mode also works without a router.

Preview runtime ownership is independent of the course provider, so importing,
previewing and disabling a plugin cannot mutate the live course registry. Posters
load only as they approach the viewport; playback pauses when the page is hidden.

Validation:

- `pnpm exec jest --runInBand --watchman=false sources/src/components/display-workspace`
- `pnpm run build`
- `node scripts/verify-display-plugin-library.cjs` (requires local browser/network access)

The browser acceptance run checks every built-in example at early/middle/late
frames, URL history, search, categories, playback, declarative imports, disabled
previews, and 390px layouts. Generate reports in a local ignored output directory.
