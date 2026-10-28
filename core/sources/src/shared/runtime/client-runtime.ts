import type { RuntimeDescriptor } from "../../../libs/runtime-contracts/src/index.js";

const hostedWebRuntime: RuntimeDescriptor = {
  schemaVersion: 1,
  kind: "web-hosted",
  os: "web",
  arch: "browser",
  appVersion: "web",
  capabilities: {
    authentication: true,
    billing: true,
    publicCatalog: true,
    sharing: true,
    cloudSync: true,
    localAdmin: false,
    nativeFilesystem: false,
    nativeTerminal: false,
    agendaReminderDelivery: true,
    scenarioTheaterGeneration: true,
  },
};

let clientRuntime: RuntimeDescriptor = hostedWebRuntime;

/** Configure once during a non-web renderer bootstrap, before React mounts. */
export function configureClientRuntime(runtime: RuntimeDescriptor): void {
  clientRuntime = runtime;
}

export function getClientRuntime(): RuntimeDescriptor {
  return clientRuntime;
}

export function isDesktopLocalRuntime(): boolean {
  return clientRuntime.kind === "desktop-local";
}

/** Desktop-local keeps durable application state in SQLite, never Web Storage. */
export function canUseBrowserPersistentStorage(): boolean {
  return !isDesktopLocalRuntime();
}

export function supportsAssistantSpaceOrganization(): boolean {
  return clientRuntime.capabilities.assistantSpaceOrganization !== false;
}

/**
 * The global assistant is a durable, tool-capable thread surface.  Local
 * runtimes must opt in only after their SQLite adapter implements the shared
 * create/read/send/resume/stream contract; omission keeps hosted compatibility.
 */
export function supportsGlobalAssistant(): boolean {
  return clientRuntime.capabilities.globalAssistant !== false;
}

/** Local normal text threads may be bound to an owned goal or unit. */
export function supportsScopedAssistantTextThreads(): boolean {
  return clientRuntime.capabilities.assistantScopedTextThreads === true;
}

export function supportsGoalOverviewGeneration(): boolean {
  return clientRuntime.capabilities.goalOverviewGeneration !== false;
}

/** Instant micro-course generation requires the runtime's goal SSE authority. */
export function supportsGoalInstantMicroGeneration(): boolean {
  return clientRuntime.capabilities.goalInstantMicroGeneration !== false;
}

export function supportsGoalWebResources(): boolean {
  return clientRuntime.capabilities.goalWebResources !== false;
}

/** User-supplied URL documents use the shared extraction/index contract. */
export function supportsGoalDocumentUrls(): boolean {
  return clientRuntime.capabilities.goalDocumentUrls !== false;
}

export function supportsMaterialFollowUps(): boolean {
  return clientRuntime.capabilities.materialFollowUps !== false;
}

/** Per-block complex-component regeneration (hosted + desktop-local). */
export function supportsMaterialComponentRegeneration(): boolean {
  return clientRuntime.capabilities.materialComponentRegeneration !== false;
}

/** Per-block authored-material illustration regeneration (hosted + desktop-local). */
export function supportsMaterialIllustrationRegeneration(): boolean {
  return clientRuntime.capabilities.materialIllustrationRegeneration !== false;
}

export function supportsGoalPlanLegacyGeneration(): boolean {
  return clientRuntime.capabilities.goalPlanLegacyGeneration !== false;
}

export function supportsGoalMasteryTransition(): boolean {
  return clientRuntime.capabilities.goalMasteryTransition !== false;
}

export function supportsGoalKacomDetach(): boolean {
  return clientRuntime.capabilities.goalKacomDetach !== false;
}

export function supportsGoalMapAuthoring(): boolean {
  return clientRuntime.capabilities.goalMapAuthoring !== false;
}

export function supportsGoalMapRefresh(): boolean {
  return clientRuntime.capabilities.goalMapRefresh !== false;
}

export function supportsGoalTextbookExport(): boolean {
  return clientRuntime.capabilities.goalTextbookExport !== false;
}

/** Development-only batch Survey/material generation requires hosted routes. */
export function supportsGoalBatchGeneration(): boolean {
  return clientRuntime.capabilities.goalBatchGeneration !== false;
}

/** Hosted goal icons are provider-generated; local SQLite uses GoalIcon's deterministic fallback. */
export function supportsGoalIconGeneration(): boolean {
  return getClientRuntime().capabilities.goalIconGeneration !== false;
}

/**
 * Hosted flashcards require the deck/card/source DTOs plus provider-backed
 * generation and FSRS review routes. Local SQLite only has its separate
 * bounded unit-review scheduler, so it opts out until those contracts share
 * one authority.
 */
export function supportsFlashcards(): boolean {
  return clientRuntime.capabilities.flashcards !== false;
}

/** Agenda reminder preferences are actionable only when delivery is wired. */
export function supportsAgendaReminderDelivery(): boolean {
  // Older hosted descriptors omit this optional field; hosted behavior remains
  // enabled by default. Local runtimes opt out until a native delivery bridge
  // exists.
  return clientRuntime.capabilities.agendaReminderDelivery !== false;
}

/** Section chat narration requires a durable asset catalog and byte route. */
export function supportsChatAudioGeneration(): boolean {
  // Older hosted descriptors omit this optional field; hosted behavior remains
  // enabled by default. Local runtimes use their SQLite catalog/byte route and
  // explicitly document the local-v1 text-clock timing fallback.
  return clientRuntime.capabilities.chatAudioGeneration !== false;
}

/** Hosted runtimes may use provider authoring; local uses the shared
 * server-owned deterministic fallback and persists the resulting scenes. */
export function supportsScenarioTheaterGeneration(): boolean {
  return clientRuntime.capabilities.scenarioTheaterGeneration !== false;
}

/** Keep the shared theater activity visible only when it has an authority.
 * Local can still replay a prepared/ready definition from SQLite, but must not
 * advertise a generate action that would hit the unavailable authoring stream.
 */
export function isScenarioTheaterActivityAvailable(
  content: { status?: string; definition?: unknown } | null | undefined,
  isMicro: boolean,
): boolean {
  if (isMicro) return false;
  if (supportsScenarioTheaterGeneration()) return true;
  return Boolean(
    content?.definition &&
      (content.status === "prepared" || content.status === "ready"),
  );
}

export { isUnitLabActivityAvailable } from "../domain/unit-lab.js";

/** Keep development-only hosted panels hidden whenever their route is absent. */
export function shouldRenderGoalBatchGeneration(
  isDevelopment: boolean,
): boolean {
  return isDevelopment && supportsGoalBatchGeneration();
}

/** Goal snapshots/public links require the hosted sharing authority. */
export function supportsGoalSharing(): boolean {
  return clientRuntime.capabilities.sharing !== false;
}
