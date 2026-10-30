# Independent reading content

Reading is a short structured-generation pipeline for responsive textbook prose.
Display remains the presentation and video authoring pipeline. Opening or
generating one does not require the other to be ready.
The reading API and page expose only independently authored reading documents.
Saved Display material is never appended as “previous content” or used as the
reading page's empty-state or completion fallback. Display records stay intact.

The authoring contract in `domain/reading-document` contains headings,
paragraphs, four callout variants, optional explanations, ordered methods,
comparisons, concept cards, summaries, self-checks and component slots.
It has no narration, layout coordinates, motion trees or plugin catalog.
The host assigns stable block IDs within each immutable document job.
Authoring chooses representations by teaching value. Relationships, processes,
architecture, state transitions and spatial structure should use an explanatory
SVG when seeing the relationship improves understanding. Function behavior uses
plots with suitable domains and optional parameters; supplied discrete data can
use an SVG chart without invented measurements. Concrete visual details use
images, and substantial mathematical arguments use derivation components.
Slots sit next to the relevant introduction and interpretation, with enough
source facts and a clear teaching question for the independent component job.
Neither basic-block variety nor visual count has a quota. Continuous prose and
short cards must not crowd out useful components or become a wall of cards.
Callout variants are internal structure. The reader and PDF show their actual
content titles and body as part of the article, without an extra category badge
or a colored card frame. Authoring uses descriptive titles rather than generic
"Example", "Definition", "Tip" or "Warning" labels.
The body uses the existing JIT JSON-array parser: each complete valid block is
published immediately, before the whole response finishes. The raw-stream
prompt includes the complete block schema; unambiguous `prose/content` aliases
normalize before validation. Unfinished JSON objects never launch component
work. Invalid blocks do not block later valid content. Source positions assign
stable IDs even when repaired gaps are filled, so visible answers and components
do not acquire another block's identity.

`ReadingWorkspaceService` persists two independent queues in each workspace:

- `reading-documents`: streaming chapter text, concurrency 2.
- `reading-components`: plots, safe SVGs, images and derivations, concurrency 2.

The queues are separate from `display-builds`. A ready reading document can
contain pending or failed components. Each slot keeps its own durable job;
retrying a slot does not repeat the body call. Checkpoints survive a service
restart. Owner, unit, chapter, document job and block scope are checked when
resolving or controlling work, so an old component cannot replace a new version.
Saved reading chapters remain accessible if Display changes the source outline.

The source adapter reads the existing course projection without a Display-ready
gate and leaves all existing material and derivation records untouched. It
exposes accepted illustrations and derivations for exact reuse. Finished reading
content can inform subsequent Display authoring without waiting for pending
figures.

Derivations contain premises and ordered `{id, result, reason, dependsOn}` steps,
with optional conditions and relation. Dependencies must refer to earlier steps
or declared premises. The reading renderer lists results and reasons. The
`teaching-derivation/reading` adapter feeds the same steps to the existing
compiler and Display renderer, which compute presentation transitions. This
validates structure and dependency order; it is not an algebra proof checker.
Saved results containing dollar/bracket delimiters or adjacent prose are split
into formulas and notes at presentation time. Known over-escaped standalone
commands are recovered without rewriting stored content or TeX matrix rows.
The same formatting is used in the reader, Display adapter and PDF export.

Diagrams open at a readable label size with a scrollable canvas, a fit-width
option and an expanded zoomable view. New SVG instructions require large labels
and uncluttered layouts at the article's expected width.
Desktop aligns headings, prose, comparisons, concept cards and callouts to one
reading column. Visual components can use the wider page, including focus mode.
Comparison and concept layouts reflow with the available reader width, including
when a sidebar is open. Heading-to-content spacing is controlled at block level
so nested component margins do not create gaps.

The HTML exporter expands explanations and includes answer keys. It renders
function curves from the same safe expressions and default parameters and
retains an explicit notice for unfinished figures. Desktop prints this
self-contained HTML using its own Chromium in an isolated, script-free window,
then closes the print window. No separate browser download is required.

Desktop exposes `view=reading` and `view=display` as chapter-body preferences
inside one learning journey. Preview, chapter navigation, mini-tests, guiding
questions, recall, correction, completion, references and immersive controls use
the same components and session. Only content chapters switch between reading
and Display. Both use `section`; old `readingSection` links migrate to it.
Visited bodies stay mounted while switching within a chapter, preserving active
work and local interactions. Reading uses the same section-completion action and
the same assessment gates. Ready reading can supply teaching context to the
shared assessment flow without generating Display or rewriting its content.
Reading self-check answers remain local practice and do not publish assessment
or mastery records.
While work is active, scoped SSE updates push each saved block and completed
component to the reading view. Polling is only a reconnect fallback. Disconnecting,
switching mode or reloading the page does not cancel the authoring job, and the
latest published prefix restores on reconnect.
Text selection in a published reading block opens the shared follow-up
workspace. Its anchor includes the reading job and block IDs. The server loads
that exact owned reading version, including a JIT prefix, for the quote and
surrounding context. Reading questions never resolve through Display block
indices, and Display highlights exclude reading anchors.

Verification includes queue independence, retry, ownership, restart, source
preservation and dependency validation. Desktop's `scripts/verify-reading-ui.mjs`
uses real Electron and the real local service with a disposable course and a
deterministic local model endpoint; it is a workflow check, not a model-quality
benchmark.
