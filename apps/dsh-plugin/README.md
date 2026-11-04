# XueLearn for DeepSeek Harness

Personal learning inside DSH: create a learning goal, read generated lessons and ask anchored follow-up questions, explore Core demonstrations, practise with Core assessments, and resume the saved lesson after restarting DSH.

This package targets **DSH 0.2.1-rc.5**, with both its Desktop IPC and authenticated Web transport. The package can be installed as one DSH bundle; a separate XueLearn Electron application is not required. Publication to npm or a plugin market is a separate release step.

## Install or update the release bundle

Download `xue-learn-dsh-plugin-0.1.1.tgz` from the [DSH v0.1.1 release](https://github.com/syjstc/xue-learn/releases/tag/dsh-v0.1.1). In DSH's Plugin Manager, install the downloaded archive using its absolute path. The installed DSH 0.2.1 plugin manager accepts local `.tgz` package archives and installs their production dependencies.

For the Desktop CLI, fully quit DSH before running:

```sh
dsh plugin --profile desktop add /absolute/path/to/xue-learn-dsh-plugin-0.1.1.tgz
```

Reopen DSH and select **好会学** in the sidebar. Installing this archive updates the same `@xue-learn/dsh-plugin` bundle. Keep the same DSH profile and plugin `config.dataPath` to retain the existing learning workspace and last-open position; do not delete the plugin's data directory during an update. Models and credentials remain managed by DSH.

The archive contains the compiled learning runtime and Client, not preinstalled native binaries. Dependency installation needs network access and native packages compatible with the host Node version and OS/architecture. This release has been built on Apple silicon macOS; Windows and Linux still require separate acceptance. The bundle is distributed as a GitHub attachment; it has not been published to npm or a plugin market.

## Build and install

From the public monorepo root, install the workspace dependencies and build the current Core, then build this app:

```sh
pnpm install --frozen-lockfile
pnpm run build:core
pnpm --dir apps/dsh-plugin build
pnpm --dir apps/dsh-plugin test
```

In DSH's Plugin Manager, install the local `apps/dsh-plugin` bundle. Open **好会学** in the sidebar. The plugin follows DSH's current default provider and model through `agentDefaultModel.currentSelection()`; learners manage models and credentials in DSH. Learning calls default to thinking Off independently of the host chat's preference. A new call reads the latest host model. Host or runtime updates require a DSH restart; the development Client bundle reloads when rebuilt.

For the Desktop profile, the equivalent development installation is:

```sh
dsh plugin --profile desktop add link:/absolute/path/to/xue-learn-public/apps/dsh-plugin
```

The plugin mounts Desktop's shared `LearnerRoutes`, `WorkspaceShell`, `MainlineProvider` and `AssistantProvider`. Learning spaces, goal plans, module pages, Reading/Presentation and assessments use the same pages as the standalone app. Settings are limited to learning preferences and appearance; DSH owns account, model and log management. The goal sidebar exposes the native expandable module and lesson directory, including locked and preparing modules.

Goal creation uses the same topic dialog, discovery questions, settings form, confirmation card, plan review and progress indicator against the Core goal-creation session API. Uploaded documents and URLs use the existing session resource endpoints. An unfinished creation session can be resumed after reopening the plugin.

Reading and Presentation share the native learning journey and Core section manifest. Anchored questions open the app's resizable right-hand assistant with saved threads, quote highlights, graphical answers and follow-up input. The plugin and assistant use the XueLearn Logo. The assistant has an independent, process-owned “学习助手” identity in both UI and generation prompts. Teacher selection, persona customization, course orientation and the duplicate learner/account menu are omitted. A direct Settings link keeps learning preferences and appearance reachable. Assessments use the shared diagnostic/assessment pages with persisted results. The plugin restores the complete native route, including spaces, modules, section and view, and migrates the earlier lesson-only position preference.

Desktop's complete stylesheet supplies the reset, spacing, typography and tokens. Styles remain scoped to the plugin. Its breakpoints, fixed surfaces, resize coordinates and portals use the embedded panel's bounds, including the narrower content area beside the assistant. Brand assets are bundled instead of requesting nonexistent DSH root assets. Appearance and sidebar preferences use the plugin's own SQLite workspace. Reading snapshots use authenticated streaming SSE over DSH's fetch carrier, so partial text and completed components render immediately; polling remains a reconnect fallback. Plugin model calls explicitly disable thinking without changing the host chat's model preferences.

| Area | Earlier plugin | Current shared app surface |
| --- | --- | --- |
| Learning spaces | Flat goal list | Space browser, goal organization, cards and roadmap |
| Course navigation | Lesson and chapter selects | Plan, catalog, module pages, expandable lesson tree and journey |
| Follow-up questions | Form below the lesson | Native right assistant, anchored quotes, history and resizing |
| Reading / Presentation | Separate simplified controls | Native unit page, chapter journey and focus mode |
| Practice | Simplified assessment form | Native diagnostics, assessments, persisted grading and review |
| Layout | Extra large header, title card and padding | Shared page styles with only embedded-frame adaptations |
| Resume | Last goal / lesson / section | Native route and persisted UI preferences |

To inspect the publishable file list after building:

```sh
pnpm --dir apps/dsh-plugin pack:check
```

To create the same release archive from the built workspace:

```sh
mkdir -p .release/dsh
pnpm --dir apps/dsh-plugin pack --pack-destination ../../.release/dsh
```

The package exports its Host entry, compiled Client entry, localized metadata and original icon, and declares `dsh.bundle.patch` and `engines.dsh`. The build includes the reusable learning runtime and migration assets. Native dependencies must be installed for the target OS/architecture; a successful local Mac build does not establish Windows or Linux acceptance.

## Architecture

- `host.mjs` contributes the `xuelearn` agent tool and one exact, authenticated Connection route. UI and tool operations call the same Core endpoints. Connection admits the owning DSH user and carries requests through HTTP or Desktop IPC.
- `lib/runtime-host.mjs` owns a separate learning-runtime worker, its private bearer token, startup, cancellation and shutdown. The worker reuses Core and Desktop's persistence composition without launching Electron.
- `lib/model-bridge.mjs` reads DSH's live default model and uses `ctx.llm.prepareCall()` to capture its adapter defaults and route before streaming through the host's `llm/stream` pipeline. Tool schemas, call IDs, arguments and tool results retain their identity across authoring rounds. No model credential is sent to the worker.
- `lib/model-session.mjs` acquires a native `sessionPersistence` write handle before publishing each diagnostic Session. Standard request headers, message events, timed provider chunks, usage and terminal outcomes go to DSH's configured storage. Request inputs are flushed before dispatch; settlement is flushed before completion and releases its live session/write handle. Runtime output uses DSH's scoped `xuelearn` logger. The plugin no longer writes its own `model-journal.jsonl`; existing journal files are left intact.
- The Client mounts the shared Desktop learner application. DSH-specific code supplies its isolated memory router, route persistence, API transport, preferences, embedded viewport and portal container. The native assistant and navigation are reused directly.
- Core SQLite owns spaces, courses, generated sections, assistant/follow-up threads, assessments, UI preferences and learning evidence. `plugin-state.json` owns only the last-open route and compatible goal/lesson/section/tab fields.

Agent workflow: `create_goal` returns an ID, `plan_goal` generates the V2 plan (`/plan/stream`), and `approve_plan` queues module preparation (`POST /plan`). Read `get_goal` while that preparation settles to obtain actual lesson IDs before generating reading content. The legacy `/map/stream` endpoint does not prepare V2 courses.

By default plugin data is stored under the active DSH profile's `data/xuelearn` directory. When no profile directory is provided, the fallback is `~/.dsh/xuelearn/data/xuelearn`. The bundle's `config.dataPath` can select an isolated directory for acceptance tests. The plugin never opens the standalone XueLearn application's live database.

## Model and feature scope

Text generation uses DSH's configured default model and adapter defaults, with thinking explicitly Off. The exact model must support a non-thinking mode or have no reasoning control; a reasoning-only model reports that it cannot disable thinking. The plugin does not select an independent fallback if the host route is unavailable. Core retains its structured-output validation and retry behavior. Disabling the plugin cancels in-flight model requests, waits for native log settlement, and stops its worker. Restarting opens the same Core workspace and restores the last-open learning position.

Model-call records use native Session IDs prefixed with `xuelearn-`, grouped under the plugin data directory, and participate in the host's session persistence/export and configured telemetry pipeline. The latest ID is available from the authenticated `/xuelearn/host/status` endpoint as `lastModelSessionId`. Logging does not change DSH's upload or telemetry settings. Each record is a diagnostic model attempt, not a continuable DSH agent. Tool-producing responses use `assistant/attempt` to retain the exact stream because Core, rather than DSH's agent loop, executes those tools. Imported Core history retains its messages and tool correlation without inventing historical provider streams or usage. Core's learning state, structured validation and operation evidence remain in its separate learning workspace; no standalone model/log administration UI is exposed.

DSH 0.2.1 exposes tool schemas without a forced-tool-selection option. Required or named Core tool calls use explicit instructions (and a restricted schema list for named calls), followed by validation. A missing or undeclared tool call is reported as a failure rather than accepted as a successful authoring turn.

Image generation, speech, external web search and optional embedding models require separate capability configuration. They do not receive credentials from the DSH text model. Text lessons and lexical retrieval do not require downloading an embedding model.

This first bundle does not expose Desktop-only PDF export, Python execution or isolated lab runtimes. Existing textual code and lab descriptions remain readable. Mathematical and SVG demonstrations use the DSH text model and the bundled Core renderers.

## Verification

`node --test test/*.test.mjs` exercises persisted resume preferences, exact DSH model transport, terminal failures, cooperative cancellation, authenticated carrier routing, learning-only endpoint restrictions, Core tool mappings and worker lifecycle. Full acceptance also requires exercising the installed plugin against a real DSH model, submitting a Core practice answer, and restarting DSH to verify restored content and position.
