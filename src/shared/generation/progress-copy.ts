export type GenerationProgressKind =
  | "material"
  | "sq"
  | "notes"
  | "quiz";

type GenerationProgressKey =
  | "generation.material.preparing"
  | "generation.material.progress"
  | "generation.material.refining"
  | "generation.sq.preparing"
  | "generation.sq.progress"
  | "generation.notes.preparing"
  | "generation.notes.progress"
  | "generation.quiz.preparing"
  | "generation.quiz.progress";

type Translate = (
  key: GenerationProgressKey,
  params?: Record<string, string | number>,
) => string;

const PREPARING_KEYS: Record<GenerationProgressKind, GenerationProgressKey> = {
  material: "generation.material.preparing",
  sq: "generation.sq.preparing",
  notes: "generation.notes.preparing",
  quiz: "generation.quiz.preparing",
};

const PROGRESS_KEYS: Record<GenerationProgressKind, GenerationProgressKey> = {
  material: "generation.material.progress",
  sq: "generation.sq.progress",
  notes: "generation.notes.progress",
  quiz: "generation.quiz.progress",
};

export function formatGenerationProgress(
  t: Translate,
  kind: GenerationProgressKind,
  count: number,
  refiningCount = 0,
): string {
  if (count <= 0) return t(PREPARING_KEYS[kind]);
  const progress = t(PROGRESS_KEYS[kind], { count });
  if (kind !== "material" || refiningCount <= 0) return progress;
  return `${progress} ${t("generation.material.refining", {
    count: refiningCount,
  })}`;
}

const SURVEY_PROCESS_STATUS_PHASES = new Set([
  "cognitive_model",
  "verification",
  "section_plan",
]);

export function formatSqGenerationStatus(
  t: Translate,
  state: {
    status: string;
    phase?: string;
    partialCount: number;
  },
): string {
  if (
    state.phase &&
    SURVEY_PROCESS_STATUS_PHASES.has(state.phase) &&
    state.status
  ) {
    return state.status;
  }
  if (state.partialCount > 0) {
    return formatGenerationProgress(t, "sq", state.partialCount);
  }
  return state.status || t("generation.sq.preparing");
}
