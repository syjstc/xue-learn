import { z } from "zod";

export const runtimeKinds = [
  "web-hosted",
  "desktop-hosted",
  "desktop-local",
  "mobile",
  "miniprogram",
] as const;
export const runtimeKindSchema = z.enum(runtimeKinds);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export const operatingSystems = [
  "web",
  "ios",
  "android",
  "macos",
  "windows",
  "linux",
] as const;
export const operatingSystemSchema = z.enum(operatingSystems);
export type OperatingSystem = z.infer<typeof operatingSystemSchema>;

export const runtimeCapabilitiesSchema = z.object({
  authentication: z.boolean(),
  billing: z.boolean(),
  publicCatalog: z.boolean(),
  sharing: z.boolean(),
  cloudSync: z.boolean(),
  /** Desktop-local can synchronize encrypted workspaces through a personal transport. */
  personalCloudSync: z.boolean().optional(),
  localAdmin: z.boolean(),
  nativeFilesystem: z.boolean(),
  nativeTerminal: z.boolean(),
  /** Runtime can create, resume, and stream the shared global assistant thread. */
  globalAssistant: z.boolean().optional(),
  /** Runtime can persist normal text-only goal/unit assistant threads (without tools). */
  assistantScopedTextThreads: z.boolean().optional(),
  /** Runtime assistant can author and apply Learning Space organization proposals. */
  assistantSpaceOrganization: z.boolean().optional(),
  /** Runtime can start `goal.overview` SSE (课程导览 / micro material refresh). */
  goalOverviewGeneration: z.boolean().optional(),
  /** Runtime can create an instant micro-course through its goal SSE flow. */
  goalInstantMicroGeneration: z.boolean().optional(),
  /** Hosted search can ingest URLs and manage goal-scoped web sources. */
  goalWebResources: z.boolean().optional(),
  /** Runtime can ingest and refresh user-supplied URL documents into its local index. */
  goalDocumentUrls: z.boolean().optional(),
  /** Runtime can persist anchored material follow-ups. */
  materialFollowUps: z.boolean().optional(),
  /** Runtime can regenerate an individual authored material component. */
  materialComponentRegeneration: z.boolean().optional(),
  /** Runtime can regenerate an authored material illustration in place. */
  materialIllustrationRegeneration: z.boolean().optional(),
  /** Hosted legacy plan/map SSE can regenerate an existing goal outside creation. */
  goalPlanLegacyGeneration: z.boolean().optional(),
  /** Hosted exploration goals can transition into KACOM-backed mastery in place. */
  goalMasteryTransition: z.boolean().optional(),
  /** Internal hosted builds may detach KACOM for controlled testing. */
  goalKacomDetach: z.boolean().optional(),
  /** Runtime can mutate/regenerate the legacy learning map and course pattern. */
  goalMapAuthoring: z.boolean().optional(),
  /** Runtime can refresh existing map titles, summaries, and sibling order. */
  goalMapRefresh: z.boolean().optional(),
  /** Runtime can render and download the hosted PDF textbook export. */
  goalTextbookExport: z.boolean().optional(),
  /** Development-only batch Survey/material generation endpoints are available. */
  goalBatchGeneration: z.boolean().optional(),
  /** Runtime exposes provider-backed goal icon generation. */
  goalIconGeneration: z.boolean().optional(),
  /** Runtime exposes the hosted flashcard deck/generation/FSRS review contract. */
  flashcards: z.boolean().optional(),
  /** Runtime can deliver the agenda's scheduled reminder notification. */
  agendaReminderDelivery: z.boolean().optional(),
  /** Runtime can synthesize/cache section chat-narration audio. */
  chatAudioGeneration: z.boolean().optional(),
  /** Runtime can author and generate scenario-theater definitions/scenes. */
  scenarioTheaterGeneration: z.boolean().optional(),
});
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>;

export const runtimeDescriptorSchema = z.object({
  schemaVersion: z.literal(1),
  kind: runtimeKindSchema,
  os: operatingSystemSchema,
  arch: z.string().min(1),
  appVersion: z.string().min(1),
  capabilities: runtimeCapabilitiesSchema,
});
export type RuntimeDescriptor = z.infer<typeof runtimeDescriptorSchema>;

export const DESKTOP_LOCAL_CAPABILITIES: RuntimeCapabilities = Object.freeze({
  authentication: false,
  billing: false,
  publicCatalog: false,
  sharing: false,
  cloudSync: false,
  // Desktop-local understands the encrypted personal-sync protocol and ships
  // the learner-selected folder transport.
  personalCloudSync: true,
  localAdmin: true,
  nativeFilesystem: true,
  nativeTerminal: false,
  // Local desktop supports the durable global assistant and its SQLite-backed
  // Learning Space proposal/apply flow. Other hosted-only assistant actions
  // remain gated individually below.
  globalAssistant: true,
  assistantScopedTextThreads: true,
  assistantSpaceOrganization: true,
  // Local desktop mounts the same GoalsModule `POST …/overview/stream` as hosted
  // web. Opening 课程导览 starts that foreground SSE; a failed run retries by
  // starting the stream again.
  goalOverviewGeneration: true,
  // Desktop-local mounts the same goal SSE authority as hosted web; only the
  // persistence runtime underneath it changes to the private SQLite store.
  goalInstantMicroGeneration: true,
  goalWebResources: false,
  // URL documents reuse the shared safe extraction boundary and are persisted
  // in the local document index; hosted web-knowledge search remains separate.
  goalDocumentUrls: true,
  // The local LearningModule mounts the shared anchored follow-up routes and
  // persists threads/merged material through the SQLite MikroORM adapters.
  materialFollowUps: true,
  // Local LearningModule mounts the shared per-component regenerate route.
  materialComponentRegeneration: true,
  // Local LearningModule also mounts illustration regenerate and persists
  // files under IMAGE_STORAGE_DIR / unit-images.
  materialIllustrationRegeneration: true,
  goalPlanLegacyGeneration: false,
  // Foundation/exploration → mastery now has a durable local transition
  // boundary. Readiness remains server-owned and can still fail closed when
  // the current curriculum/KACOM audit is incomplete.
  goalMasteryTransition: true,
  goalKacomDetach: false,
  goalMapAuthoring: false,
  // The learner-facing map view and its refresh controls were retired. Keep
  // the local adapter available only for legacy data/recovery tests; shared
  // desktop UI must not advertise or call this hosted map capability.
  goalMapRefresh: false,
  goalTextbookExport: false,
  // Local runtime intentionally has no hosted batch SQ/material controller.
  goalBatchGeneration: false,
  // Goal icons fall back deterministically; local SQLite has no provider route.
  goalIconGeneration: false,
  // SQLite currently only persists the bounded unit-review scheduler. It does
  // not expose hosted FlashCardDeck/card/source DTOs or FSRS review routes.
  flashcards: false,
  // Reminder preferences are persisted locally, but there is no desktop
  // notification scheduler or native delivery bridge yet.
  agendaReminderDelivery: false,
  // Local section narration reuses the shared content/audio provider boundary
  // and persists learner-scoped bytes, content hashes, and local-v1 timing
  // metadata in SQLite. It exposes the hosted catalog/ensure/byte routes;
  // provider-specific timing/persona enrichment remains an adapter detail.
  chatAudioGeneration: true,
  // Local reuses the server-owned deterministic scenario fallback and stores
  // the published definition/scenes in SQLite; provider-specific authoring is
  // still intentionally absent, but the shared theater process is playable.
  scenarioTheaterGeneration: true,
});

export const LOCAL_OWNER_ID = "local-owner-v1";
/** Fresh MikroORM database filename; the retired LocalSqliteKernel file is not reused. */
export const DESKTOP_LOCAL_DATABASE_FILENAME = "xuelearn-local-v2.sqlite3";

export function isDesktop(runtime: RuntimeDescriptor): boolean {
  return runtime.kind === "desktop-local" || runtime.kind === "desktop-hosted";
}

export function isMobile(runtime: RuntimeDescriptor): boolean {
  return runtime.kind === "mobile";
}

export function isMac(runtime: RuntimeDescriptor): boolean {
  return runtime.os === "macos";
}

export function isWindows(runtime: RuntimeDescriptor): boolean {
  return runtime.os === "windows";
}

export function isIos(runtime: RuntimeDescriptor): boolean {
  return runtime.os === "ios";
}

export function isAndroid(runtime: RuntimeDescriptor): boolean {
  return runtime.os === "android";
}
