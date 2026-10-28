import { createHash } from "node:crypto";
import type {
  CognitiveModelPresentationReadRepository,
  LearnerStateMemoryInvalidationRepository,
  LearnerStateMemoryMaintenanceRepository,
  LearnerStateMemoryReadRepository,
  LearnerStateProjectionReadRepository,
} from "../../../domain/src/index.js";
import { COGNITION_INFERENCE_VERSION } from "../cognition/persistence.js";
import { DEFAULT_DIMENSION_INFERENCE_THRESHOLDS } from "../cognition/inference.js";
import { getGoalCognitiveModel } from "../cognitive-model/index.js";

export const LEARNER_STATE_MEMORY_SCHEMA_VERSION = 1;
export const LEARNER_STATE_MEMORY_SOURCE_SCHEMA_VERSION = 1;
const TARGET_LIST_LIMIT = 24;
const PER_GOAL_TARGET_LIMIT = 8;
export const GLOBAL_LEARNER_STATE_MEMORY_PROMPT_HEADER =
  "Global learner cognitive memory";

let configuredLearnerStateMemoryRead:
  LearnerStateMemoryReadRepository | undefined;
let configuredLearnerStateMemoryMaintenance:
  LearnerStateMemoryMaintenanceRepository | undefined;
let configuredCognitiveModelPresentationRead:
  CognitiveModelPresentationReadRepository | undefined;
let configuredLearnerStateProjectionRead:
  LearnerStateProjectionReadRepository | undefined;
let configuredLearnerStateMemoryInvalidation:
  LearnerStateMemoryInvalidationRepository | undefined;

/** Install the process-local read optimization from the active ORM composition. */
export function configureLearnerStateMemoryRead(
  memoryRead: LearnerStateMemoryReadRepository | undefined,
  maintenance?: LearnerStateMemoryMaintenanceRepository,
  presentationRead?: CognitiveModelPresentationReadRepository,
  stateRead?: LearnerStateProjectionReadRepository,
  invalidation?: LearnerStateMemoryInvalidationRepository,
): void {
  configuredLearnerStateMemoryRead = memoryRead;
  configuredLearnerStateMemoryMaintenance = maintenance;
  configuredCognitiveModelPresentationRead = presentationRead;
  configuredLearnerStateProjectionRead = stateRead;
  configuredLearnerStateMemoryInvalidation = invalidation;
}

export type LearnerStateStatus =
  "unobserved" | "forming" | "demonstrated" | "robust" | "revalidate";

export type LearnerStateCounts = Record<LearnerStateStatus, number>;

export type LearnerStateMemoryDimension = {
  dimension: string;
  status: LearnerStateStatus;
  estimate: number | null;
  evidenceSufficiency: number;
  lastObservedAt: string | null;
};

export type LearnerStateMemoryTarget = {
  learningTargetId: string;
  title: string;
  goalId: string;
  goalTitle: string;
  unitId: string | null;
  unitTitle: string | null;
  importance: string;
  status: LearnerStateStatus;
  overallEstimate: number | null;
  evidenceSufficiency: number;
  lastObservedAt: string | null;
  reason: "below_threshold" | "insufficient_evidence" | "revalidate" | null;
  dimensions: LearnerStateMemoryDimension[];
};

export type LearnerStateMemoryGoal = {
  goalId: string;
  goalTitle: string;
  counts: LearnerStateCounts;
  lastObservedAt: string | null;
  practiceNeeded: LearnerStateMemoryTarget[];
  evidenceNeeded: LearnerStateMemoryTarget[];
  revalidationDue: LearnerStateMemoryTarget[];
  demonstrated: LearnerStateMemoryTarget[];
};

export type LearnerStateMemoryProjection = {
  schemaVersion: number;
  inferencePolicyVersion: number;
  counts: LearnerStateCounts;
  goals: LearnerStateMemoryGoal[];
  practiceNeeded: LearnerStateMemoryTarget[];
  evidenceNeeded: LearnerStateMemoryTarget[];
  revalidationDue: LearnerStateMemoryTarget[];
  demonstrated: LearnerStateMemoryTarget[];
};

export type LearningStateSummary = LearnerStateMemoryProjection & {
  asOf: string;
  refreshedAt: string | null;
  stale: boolean;
  nextRefreshAt: string | null;
  totalActiveSeconds: number;
};

function usableCachedProjection(
  row: Readonly<{
    schemaVersion: number;
    sourceSchemaVersion: number;
    inferencePolicyVersion: number;
    stateJson: unknown;
    refreshedAt: Date | null;
    invalidatedAt: Date | null;
    nextRefreshAt: Date | null;
  }>,
  now: Date,
) {
  const projection = asProjection(row.stateJson);
  if (
    !projection ||
    row.schemaVersion !== LEARNER_STATE_MEMORY_SCHEMA_VERSION ||
    row.sourceSchemaVersion !== LEARNER_STATE_MEMORY_SOURCE_SCHEMA_VERSION ||
    row.inferencePolicyVersion !== COGNITION_INFERENCE_VERSION ||
    !row.refreshedAt ||
    row.invalidatedAt ||
    (row.nextRefreshAt && row.nextRefreshAt <= now)
  ) {
    return null;
  }
  return {
    projection,
    refreshedAt: row.refreshedAt,
    nextRefreshAt: row.nextRefreshAt,
  };
}

function emptyCounts(): LearnerStateCounts {
  return {
    unobserved: 0,
    forming: 0,
    demonstrated: 0,
    robust: 0,
    revalidate: 0,
  };
}

function emptyProjection(): LearnerStateMemoryProjection {
  return {
    schemaVersion: LEARNER_STATE_MEMORY_SCHEMA_VERSION,
    inferencePolicyVersion: COGNITION_INFERENCE_VERSION,
    counts: emptyCounts(),
    goals: [],
    practiceNeeded: [],
    evidenceNeeded: [],
    revalidationDue: [],
    demonstrated: [],
  };
}

function asProjection(value: unknown): LearnerStateMemoryProjection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<LearnerStateMemoryProjection>;
  if (
    candidate.schemaVersion !== LEARNER_STATE_MEMORY_SCHEMA_VERSION ||
    !candidate.counts ||
    !Array.isArray(candidate.goals) ||
    !Array.isArray(candidate.practiceNeeded) ||
    !Array.isArray(candidate.evidenceNeeded) ||
    !Array.isArray(candidate.revalidationDue) ||
    !Array.isArray(candidate.demonstrated)
  ) {
    return null;
  }
  return candidate as LearnerStateMemoryProjection;
}

function latestIso(values: Array<string | null | undefined>): string | null {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

function addCounts(target: LearnerStateCounts, source: LearnerStateCounts) {
  for (const status of [
    "unobserved",
    "forming",
    "demonstrated",
    "robust",
    "revalidate",
  ] as const) {
    target[status] += source[status];
  }
}

function compareAttention(
  left: LearnerStateMemoryTarget,
  right: LearnerStateMemoryTarget,
): number {
  const importance = (value: string) =>
    value === "core" ? 3 : value === "supporting" ? 2 : 1;
  return (
    importance(right.importance) - importance(left.importance) ||
    (left.overallEstimate ?? 1) - (right.overallEstimate ?? 1) ||
    right.evidenceSufficiency - left.evidenceSufficiency ||
    (right.lastObservedAt ?? "").localeCompare(left.lastObservedAt ?? "") ||
    left.learningTargetId.localeCompare(right.learningTargetId)
  );
}

function compareDemonstrated(
  left: LearnerStateMemoryTarget,
  right: LearnerStateMemoryTarget,
): number {
  const rank = (status: LearnerStateStatus) =>
    status === "robust" ? 2 : status === "demonstrated" ? 1 : 0;
  return (
    rank(right.status) - rank(left.status) ||
    right.evidenceSufficiency - left.evidenceSufficiency ||
    (right.overallEstimate ?? 0) - (left.overallEstimate ?? 0) ||
    (right.lastObservedAt ?? "").localeCompare(left.lastObservedAt ?? "") ||
    left.learningTargetId.localeCompare(right.learningTargetId)
  );
}

function targetReason(state: {
  status: LearnerStateStatus;
  dimensions: Array<{
    dimension: string;
    status: LearnerStateStatus;
    estimate: number | null;
    evidenceSufficiency: number;
  }>;
  requirements: Array<{
    dimension: string;
    threshold?: number;
    required?: boolean;
  }>;
}): LearnerStateMemoryTarget["reason"] {
  if (
    state.status === "revalidate" ||
    state.dimensions.some((dimension) => dimension.status === "revalidate")
  ) {
    return "revalidate";
  }
  const belowRequiredThreshold = state.dimensions.some((dimension) => {
    if (dimension.estimate === null || dimension.evidenceSufficiency < 0.5) {
      return false;
    }
    const thresholds = state.requirements
      .filter(
        (requirement) =>
          requirement.dimension === dimension.dimension &&
          requirement.required !== false,
      )
      .map((requirement) => requirement.threshold ?? 0.7);
    const threshold = thresholds.length > 0 ? Math.max(...thresholds) : 0.7;
    return dimension.estimate < threshold;
  });
  if (belowRequiredThreshold) {
    return "below_threshold";
  }
  if (state.status === "forming") return "insufficient_evidence";
  return null;
}

function nextRevalidationAt(targets: LearnerStateMemoryTarget[]): Date | null {
  const revalidateMs =
    DEFAULT_DIMENSION_INFERENCE_THRESHOLDS.revalidateAfterDays * 86_400_000;
  let earliest: Date | null = null;
  for (const target of targets) {
    for (const dimension of target.dimensions) {
      if (
        (dimension.status !== "demonstrated" &&
          dimension.status !== "robust") ||
        !dimension.lastObservedAt
      ) {
        continue;
      }
      const due = new Date(
        new Date(dimension.lastObservedAt).getTime() + revalidateMs,
      );
      if (!earliest || due < earliest) earliest = due;
    }
  }
  return earliest;
}

async function buildProjection(
  userId: string,
  maintenance: LearnerStateMemoryMaintenanceRepository,
): Promise<{
  projection: LearnerStateMemoryProjection;
  sourceFingerprint: string;
  sourceRevisionCutoffAt: Date | null;
  nextRefreshAt: Date | null;
}> {
  const goals = await maintenance.listGoals(userId);
  const models: Array<{
    goal: (typeof goals)[number];
    model: Awaited<ReturnType<typeof getGoalCognitiveModel>>;
  }> = [];
  for (let index = 0; index < goals.length; index += 4) {
    models.push(
      ...(await Promise.all(
        goals.slice(index, index + 4).map(async (goal) => ({
          goal,
          model: await getGoalCognitiveModel(undefined, goal.id, {
            view: "full",
            userId,
            presentationRead: configuredCognitiveModelPresentationRead,
            stateRead: configuredLearnerStateProjectionRead,
          }),
        })),
      )),
    );
  }

  const globalCounts = emptyCounts();
  const goalSummaries: LearnerStateMemoryGoal[] = [];
  const allTargets: LearnerStateMemoryTarget[] = [];

  for (const { goal, model } of models) {
    const unitTitles = new Map(
      model.units.map((unit) => [unit.unitId, unit.title]),
    );
    const counts = emptyCounts();
    const targets: LearnerStateMemoryTarget[] = [];
    for (const target of model.learningTargets) {
      if (!target.state) continue;
      const status = target.state.status as LearnerStateStatus;
      counts[status] += 1;
      const dimensions = target.state.dimensions
        .filter(
          (dimension) =>
            dimension.estimate !== null ||
            target.requirements.some(
              (requirement) =>
                requirement.dimension === dimension.dimension &&
                requirement.required,
            ),
        )
        .map((dimension) => ({
          dimension: dimension.dimension,
          status: dimension.status as LearnerStateStatus,
          estimate: dimension.estimate,
          evidenceSufficiency: dimension.evidenceSufficiency,
          lastObservedAt: dimension.lastObservedAt,
        }));
      const unitId = target.unitIds[0] ?? null;
      const base = {
        learningTargetId: target.id,
        title: target.title,
        goalId: goal.id,
        goalTitle: goal.title,
        unitId,
        unitTitle: unitId ? (unitTitles.get(unitId) ?? null) : null,
        importance: target.importance,
        status,
        overallEstimate: target.state.overallEstimate,
        evidenceSufficiency: target.state.evidenceSufficiency,
        lastObservedAt: latestIso(
          dimensions.map((dimension) => dimension.lastObservedAt),
        ),
        dimensions,
      };
      targets.push({
        ...base,
        reason: targetReason({
          ...base,
          requirements: target.requirements,
        }),
      });
    }
    addCounts(globalCounts, counts);
    allTargets.push(...targets);
    const practiceNeeded = targets
      .filter((target) => target.reason === "below_threshold")
      .sort(compareAttention)
      .slice(0, PER_GOAL_TARGET_LIMIT);
    const evidenceNeeded = targets
      .filter(
        (target) =>
          target.reason === "insufficient_evidence" &&
          target.lastObservedAt !== null,
      )
      .sort(compareAttention)
      .slice(0, PER_GOAL_TARGET_LIMIT);
    const revalidationDue = targets
      .filter((target) => target.reason === "revalidate")
      .sort(compareAttention)
      .slice(0, PER_GOAL_TARGET_LIMIT);
    const demonstrated = targets
      .filter(
        (target) =>
          target.status === "demonstrated" || target.status === "robust",
      )
      .sort(compareDemonstrated)
      .slice(0, PER_GOAL_TARGET_LIMIT);
    if (targets.length > 0) {
      goalSummaries.push({
        goalId: goal.id,
        goalTitle: goal.title,
        counts,
        lastObservedAt: latestIso(
          targets.map((target) => target.lastObservedAt),
        ),
        practiceNeeded,
        evidenceNeeded,
        revalidationDue,
        demonstrated,
      });
    }
  }

  const projection: LearnerStateMemoryProjection = {
    schemaVersion: LEARNER_STATE_MEMORY_SCHEMA_VERSION,
    inferencePolicyVersion: COGNITION_INFERENCE_VERSION,
    counts: globalCounts,
    goals: goalSummaries,
    practiceNeeded: allTargets
      .filter((target) => target.reason === "below_threshold")
      .sort(compareAttention)
      .slice(0, TARGET_LIST_LIMIT),
    evidenceNeeded: allTargets
      .filter(
        (target) =>
          target.reason === "insufficient_evidence" &&
          target.lastObservedAt !== null,
      )
      .sort(compareAttention)
      .slice(0, TARGET_LIST_LIMIT),
    revalidationDue: allTargets
      .filter((target) => target.reason === "revalidate")
      .sort(compareAttention)
      .slice(0, TARGET_LIST_LIMIT),
    demonstrated: allTargets
      .filter(
        (target) =>
          target.status === "demonstrated" || target.status === "robust",
      )
      .sort(compareDemonstrated)
      .slice(0, TARGET_LIST_LIMIT),
  };

  const sourceRevisionCutoffAt =
    await maintenance.findLatestStateRevisionAt(userId);
  const sourceFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        inferencePolicyVersion: COGNITION_INFERENCE_VERSION,
        sourceRevisionCutoffAt: sourceRevisionCutoffAt?.toISOString() ?? null,
        projection,
      }),
    )
    .digest("hex");

  return {
    projection,
    sourceFingerprint,
    sourceRevisionCutoffAt,
    nextRefreshAt: nextRevalidationAt(allTargets),
  };
}

export async function invalidateLearnerStateMemory(
  userId: string,
  reason: string,
  _compatibilityClient?: unknown,
  invalidation?: LearnerStateMemoryInvalidationRepository,
): Promise<void> {
  const effectiveInvalidation =
    invalidation ?? configuredLearnerStateMemoryInvalidation;
  if (!effectiveInvalidation) {
    throw new Error("Learner-state memory invalidation is not configured");
  }
  await effectiveInvalidation.invalidate({ userId, reason });
}

async function rebuildUnderLock(userId: string): Promise<{
  projection: LearnerStateMemoryProjection;
  refreshedAt: Date;
  nextRefreshAt: Date | null;
}> {
  const maintenance = configuredLearnerStateMemoryMaintenance;
  if (!maintenance) {
    throw new Error("Learner-state memory maintenance is not configured");
  }
  return maintenance.runExclusive(userId, async (existing) => {
    const capturedInvalidatedAt = existing?.invalidatedAt ?? null;
    const now = new Date();
    const existingProjection = asProjection(existing?.stateJson);
    const due =
      !existingProjection ||
      Boolean(capturedInvalidatedAt) ||
      Boolean(existing?.nextRefreshAt && existing.nextRefreshAt <= now) ||
      existing?.inferencePolicyVersion !== COGNITION_INFERENCE_VERSION;
    if (existingProjection && !due && existing?.refreshedAt) {
      return {
        result: {
          projection: existingProjection,
          refreshedAt: existing.refreshedAt,
          nextRefreshAt: existing.nextRefreshAt,
        },
      };
    }
    const built = await buildProjection(userId, maintenance);
    const refreshedAt = new Date();
    return {
      result: {
        projection: built.projection,
        refreshedAt,
        nextRefreshAt: built.nextRefreshAt,
      },
      publication: {
        schemaVersion: LEARNER_STATE_MEMORY_SCHEMA_VERSION,
        sourceSchemaVersion: LEARNER_STATE_MEMORY_SOURCE_SCHEMA_VERSION,
        inferencePolicyVersion: COGNITION_INFERENCE_VERSION,
        sourceFingerprint: built.sourceFingerprint,
        sourceRevisionCutoffAt: built.sourceRevisionCutoffAt,
        stateJson: built.projection,
        refreshedAt,
        nextRefreshAt: built.nextRefreshAt,
      },
    };
  });
}

async function totalActiveSeconds(userId: string): Promise<number> {
  if (!configuredLearnerStateMemoryMaintenance) {
    throw new Error("Learner-state memory maintenance is not configured");
  }
  return configuredLearnerStateMemoryMaintenance.totalActiveSeconds(userId);
}

export async function getLearningStateSummary(
  userId: string,
  _compatibilityClient?: unknown,
  memoryRead?: LearnerStateMemoryReadRepository,
): Promise<LearningStateSummary> {
  const now = new Date();
  let stale = false;
  let projection = emptyProjection();
  let refreshedAt: Date | null = null;
  let nextRefreshAt: Date | null = null;
  try {
    const effectiveMemoryRead = memoryRead ?? configuredLearnerStateMemoryRead;
    if (!effectiveMemoryRead) {
      throw new Error(
        "Learner-state memory read persistence is not configured",
      );
    }
    let cached: ReturnType<typeof usableCachedProjection> | null = null;
    const row = await effectiveMemoryRead.findByUser({ userId });
    if (row) cached = usableCachedProjection(row, now);
    if (cached) {
      projection = cached.projection;
      refreshedAt = cached.refreshedAt;
      nextRefreshAt = cached.nextRefreshAt;
    } else {
      const rebuilt = await rebuildUnderLock(userId);
      projection = rebuilt.projection;
      refreshedAt = rebuilt.refreshedAt;
      nextRefreshAt = rebuilt.nextRefreshAt;
    }
  } catch (error) {
    const effectiveMemoryRead = memoryRead ?? configuredLearnerStateMemoryRead;
    if (!effectiveMemoryRead) throw error;
    const existing = await effectiveMemoryRead.findByUser({ userId });
    const existingProjection = asProjection(existing?.stateJson);
    if (!existingProjection || !existing?.refreshedAt) throw error;
    stale = true;
    projection = existingProjection;
    refreshedAt = existing?.refreshedAt ?? null;
    nextRefreshAt = existing?.nextRefreshAt ?? null;
    const message =
      error instanceof Error
        ? error.message.slice(0, 1000)
        : String(error).slice(0, 1000);
    await configuredLearnerStateMemoryMaintenance
      ?.recordError(userId, message)
      .catch(() => undefined);
  }

  return {
    ...projection,
    asOf: refreshedAt?.toISOString() ?? now.toISOString(),
    refreshedAt: refreshedAt?.toISOString() ?? null,
    stale,
    nextRefreshAt: nextRefreshAt?.toISOString() ?? null,
    totalActiveSeconds: await totalActiveSeconds(userId),
  };
}

export async function formatGlobalLearnerStateMemoryPrompt(
  userId: string,
  compatibilityClient?: unknown,
  memoryRead?: LearnerStateMemoryReadRepository,
): Promise<string> {
  const memory = await getLearningStateSummary(
    userId,
    compatibilityClient,
    memoryRead,
  );
  if (
    memory.goals.length === 0 ||
    (memory.practiceNeeded.length === 0 &&
      memory.evidenceNeeded.length === 0 &&
      memory.revalidationDue.length === 0 &&
      memory.demonstrated.length === 0)
  ) {
    return "";
  }
  const targetLine = (target: LearnerStateMemoryTarget) => {
    const dimensions = target.dimensions
      .filter((dimension) => dimension.estimate !== null)
      .map(
        (dimension) =>
          `${dimension.dimension}=${Math.round((dimension.estimate ?? 0) * 100)}%/evidence ${Math.round(dimension.evidenceSufficiency * 100)}%`,
      )
      .join(", ");
    return `- [goal: ${target.goalTitle}] ${target.title}: ${target.status}; ${dimensions || "no observed required dimension"}`;
  };
  const sections = [
    memory.practiceNeeded.length
      ? `Needs practice:\n${memory.practiceNeeded.slice(0, 10).map(targetLine).join("\n")}`
      : "",
    memory.evidenceNeeded.length
      ? `Needs more direct evidence:\n${memory.evidenceNeeded.slice(0, 8).map(targetLine).join("\n")}`
      : "",
    memory.revalidationDue.length
      ? `Due for revalidation:\n${memory.revalidationDue.slice(0, 8).map(targetLine).join("\n")}`
      : "",
    memory.demonstrated.length
      ? `Demonstrated with sufficient direct evidence:\n${memory.demonstrated.slice(0, 10).map(targetLine).join("\n")}`
      : "",
  ].filter(Boolean);
  return `${GLOBAL_LEARNER_STATE_MEMORY_PROMPT_HEADER} (cached KACOM projection; refreshed only at learning milestones; ${memory.stale ? "last-good cache" : `as of ${memory.refreshedAt ?? memory.asOf}`}):
${sections.join("\n\n")}
Rules:
- Unobserved means unknown, never weakness or failure.
- This cache cannot overwrite KACOM definitions, evidence, or learner state.
- Keep goal identities separate. Cross-goal state may support an analogy, but never transfer evidence or establish mastery in another goal.
- Adapt explanation, scaffolding, examples, and practice difficulty only where relevant.
- Safety, facts, objective requirements, scoring, GELC, and structured-output rules outrank personalization.`;
}

export async function prewarmLearnerStateMemories(
  _compatibilityClient?: unknown,
  limit = 5,
): Promise<number> {
  const now = new Date();
  const boundedLimit = Math.max(1, Math.min(limit, 5));
  const maintenance = configuredLearnerStateMemoryMaintenance;
  if (!maintenance) {
    throw new Error("Learner-state memory maintenance is not configured");
  }
  const rows = (await maintenance.listDueUsers(now, boundedLimit)).map(
    (userId) => ({ userId }),
  );
  let refreshed = 0;
  for (const row of rows) {
    try {
      await rebuildUnderLock(row.userId);
      refreshed += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : String(error).slice(0, 1000);
      await maintenance.recordError(row.userId, message);
    }
  }
  return refreshed;
}
