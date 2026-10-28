export const GOAL_MODULE_STRUCTURE_DRAFT_PREPARE_EVENT =
  "goal.module_structure.draft.prepare";
export const GOAL_MODULE_STRUCTURE_AUDIT_EVENT = "goal.module_structure.audit";
export const GOAL_CREATION_COORDINATE_EVENT = "goal.creation.coordinate";

/** Outbox statuses that must stay unpublished so the next poll can continue. */
export const AGENTIC_OUTBOX_HOLD_STATUSES = new Set([
  "deferred",
  "publishing",
]);

export const AGENTIC_AUTHORING_REMOTE_CONCURRENCY = 10;
export const AGENTIC_AUTHORING_OLLAMA_CONCURRENCY = 1;
export const AGENTIC_RESEARCH_CONCURRENCY = 4;
export const MODULE_STRUCTURE_DRAFT_LEASE_MS = 15 * 60 * 1000;
export const MAX_MODULE_AUDIT_REPAIR_ROUNDS = 1;

export function createConcurrencyLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function limit<T>(work: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

let publicationChain: Promise<void> = Promise.resolve();

export function serializeSqlitePublication<T>(work: () => Promise<T>): Promise<T> {
  const run = publicationChain.then(work, work);
  publicationChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
