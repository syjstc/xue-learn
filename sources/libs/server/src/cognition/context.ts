import type {
  LearnerStateProjectionReadRecord,
  LearnerStateProjectionReadRepository,
} from "../../../domain/src/index.js";

let configuredLearnerStateProjectionRead:
  LearnerStateProjectionReadRepository | undefined;

/** Install the process-local projection reader from the active ORM composition. */
export function configureLearnerStateProjectionRead(
  projectionRead: LearnerStateProjectionReadRepository | undefined,
): void {
  configuredLearnerStateProjectionRead = projectionRead;
}

function percent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

/** Compact inferred learner-state context. Definitions remain objective and immutable. */
export async function formatCognitiveStatePromptBlock(
  userId: string,
  goalId?: string,
  projectionRead?: LearnerStateProjectionReadRepository,
): Promise<string> {
  const stateRead = projectionRead ?? configuredLearnerStateProjectionRead;
  if (!stateRead) {
    throw new Error("Learner-state projection persistence is unavailable");
  }
  return formatProjectedCognitiveStatePromptBlock(userId, goalId, stateRead);
}

async function formatProjectedCognitiveStatePromptBlock(
  userId: string,
  goalId: string | undefined,
  projectionRead: LearnerStateProjectionReadRepository,
): Promise<string> {
  const projected = await projectionRead.listPromptStates({
    userId,
    goalId,
    asOf: new Date(),
  });
  const rows = projected
    .map(({ state, entity, latestEvidence }) => {
      const lastObservedAt = latestObservedAt(state);
      if (!lastObservedAt) return null;
      return { state, entity, latestEvidence, lastObservedAt };
    })
    .filter(
      (
        row,
      ): row is {
        state: LearnerStateProjectionReadRecord;
        entity: { id: string; title: string; kind: string };
        latestEvidence: string | null;
        lastObservedAt: Date;
      } => row !== null,
    )
    .sort(
      (left, right) =>
        left.state.evidenceSufficiency - right.state.evidenceSufficiency ||
        right.lastObservedAt.getTime() - left.lastObservedAt.getTime(),
    )
    .slice(0, goalId ? 24 : 36);
  if (!rows.length) return "";

  const lines = rows.map(({ state, entity, latestEvidence }) => {
    const dimensions = state.dimensions
      .filter((dimension) => dimension.estimate != null)
      .map(
        (dimension) =>
          `${dimension.dimension}=${percent(dimension.estimate!)} (sufficiency ${percent(dimension.evidenceSufficiency)})`,
      )
      .join(", ");
    return `- ${entity.title} [${entity.kind}]: ${state.status}; estimate ${state.overallEstimate == null ? "unobserved" : percent(state.overallEstimate)}; evidence sufficiency ${percent(state.evidenceSufficiency)}; dimensions ${dimensions || "unobserved"}; latest direct evidence ${latestEvidence ?? "none"}`;
  });

  return `Learner cognitive state inferred from direct task evidence (unobserved is not failure; never infer high-level capability from components):\n${lines.join("\n")}`;
}

function latestObservedAt(
  state: LearnerStateProjectionReadRecord,
): Date | null {
  return state.dimensions.reduce<Date | null>(
    (latest, dimension) =>
      dimension.lastObservedAt && (!latest || dimension.lastObservedAt > latest)
        ? dimension.lastObservedAt
        : latest,
    null,
  );
}
