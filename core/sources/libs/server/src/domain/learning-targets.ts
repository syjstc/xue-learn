import type {
  LearningTargetCognitiveLevel,
  LearningTargetDifficulty,
  LearningTargetImportance,
} from "../cognitive-model/workload.js";

/** Unit-scoped learning targets shared across SQ → material → task evidence. */

export type UnitLearningTarget = {
  id: string;
  label: string;
  explanation?: string;
  learningObjective?: string;
  assessmentCriteria?: string[];
  cognitiveEntityIds?: string[];
  durableId?: string;
  importance?: LearningTargetImportance;
  importanceWeight?: number;
  difficulty?: LearningTargetDifficulty;
  targetCognitiveLevel?: LearningTargetCognitiveLevel;
  rationale?: string;
  status?: "active" | "deprecated";
};

export type SqGuidingQuestion = {
  text: string;
  learningTargetIds: string[];
};

const LEARNING_TARGET_REF_RE = /^lt_\d+$/i;

export function normalizeLearningTargetId(raw: string, index: number): string {
  const trimmed = raw.trim();
  if (LEARNING_TARGET_REF_RE.test(trimmed)) return trimmed.toLowerCase();
  return `lt_${index + 1}`;
}

export function synthesizeLearningTargetId(index: number): string {
  return `lt_${index + 1}`;
}

/** Parse `lt_1,lt_2` or `lt_1;lt_2` into unique ids. */
export function parseLearningTargetIdList(raw: string): string[] {
  if (!raw.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    const id = part.trim().toLowerCase();
    if (!id || !LEARNING_TARGET_REF_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function learningTargetLabels(
  points: UnitLearningTarget[] | undefined | null,
): string[] {
  if (!points?.length) return [];
  return points.map((p) => p.label).filter(Boolean);
}

export function learningTargetLabelMap(
  points: UnitLearningTarget[] | undefined | null,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const point of points ?? []) {
    if (point.id && point.label) map.set(point.id, point.label);
  }
  return map;
}

export function resolveLearningTargetLabels(
  ids: string[] | undefined | null,
  points: UnitLearningTarget[] | undefined | null,
): string[] {
  if (!ids?.length) return [];
  const map = learningTargetLabelMap(points);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const label = map.get(id) ?? map.get(id.toLowerCase());
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/** Normalize structured guiding questions against published local target refs. */
export function normalizeSqGuidingQuestions(
  value: unknown,
): SqGuidingQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: SqGuidingQuestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const text = typeof obj.text === "string" ? obj.text.trim() : "";
    if (!text) continue;
    const rawIds = obj.learningTargetIds;
    let learningTargetIds: string[] = [];
    if (Array.isArray(rawIds)) {
      learningTargetIds = rawIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim().toLowerCase())
        .filter((id) => LEARNING_TARGET_REF_RE.test(id));
    }
    if (learningTargetIds.length === 0) continue;
    out.push({ text, learningTargetIds });
  }
  return out;
}

export function sqQuestionTexts(
  questions: readonly SqGuidingQuestion[] | undefined | null,
): string[] {
  if (!questions?.length) return [];
  return questions.map((q) => q.text?.trim() ?? "").filter(Boolean);
}

/** Normalize generated unit-local learning targets before schema validation. */
export function normalizeUnitLearningTargets(
  value: unknown,
): UnitLearningTarget[] {
  if (!Array.isArray(value)) return [];
  const out: UnitLearningTarget[] = [];
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();

  value.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const obj = item as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    if (!label || seenLabels.has(label)) return;
    const rawId = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!LEARNING_TARGET_REF_RE.test(rawId)) return;
    const id = normalizeLearningTargetId(rawId, index);
    if (seenIds.has(id)) return;
    seenIds.add(id);
    seenLabels.add(label);
    out.push({
      id,
      label,
      explanation:
        typeof obj.explanation === "string"
          ? obj.explanation.trim()
          : undefined,
      learningObjective:
        typeof obj.learningObjective === "string"
          ? obj.learningObjective.trim()
          : undefined,
      assessmentCriteria: Array.isArray(obj.assessmentCriteria)
        ? obj.assessmentCriteria.filter(
            (criterion): criterion is string =>
              typeof criterion === "string" && Boolean(criterion.trim()),
          )
        : undefined,
      cognitiveEntityIds: Array.isArray(obj.cognitiveEntityIds)
        ? obj.cognitiveEntityIds.filter(
            (entityId): entityId is string =>
              typeof entityId === "string" && Boolean(entityId.trim()),
          )
        : undefined,
      durableId:
        typeof obj.durableId === "string" && obj.durableId.trim()
          ? obj.durableId.trim()
          : undefined,
      importance:
        obj.importance === "core" ||
        obj.importance === "supporting" ||
        obj.importance === "enrichment"
          ? obj.importance
          : undefined,
      importanceWeight:
        typeof obj.importanceWeight === "number"
          ? Math.max(1, Math.min(5, Math.round(obj.importanceWeight)))
          : undefined,
      difficulty:
        obj.difficulty === "easy" ||
        obj.difficulty === "medium" ||
        obj.difficulty === "hard"
          ? obj.difficulty
          : undefined,
      targetCognitiveLevel:
        obj.targetCognitiveLevel === "remember" ||
        obj.targetCognitiveLevel === "understand" ||
        obj.targetCognitiveLevel === "apply" ||
        obj.targetCognitiveLevel === "analyze" ||
        obj.targetCognitiveLevel === "evaluate" ||
        obj.targetCognitiveLevel === "create"
          ? obj.targetCognitiveLevel
          : undefined,
      rationale:
        typeof obj.rationale === "string" && obj.rationale.trim()
          ? obj.rationale.trim()
          : undefined,
      status:
        obj.status === "active" || obj.status === "deprecated"
          ? obj.status
          : undefined,
    });
  });

  return out;
}

export function formatLearningTargetsForPrompt(
  points: UnitLearningTarget[] | undefined | null,
): string {
  if (!points?.length) return "(none)";
  return points
    .map((point) => {
      const details = [
        point.explanation ? `Explanation: ${point.explanation}` : "",
        point.learningObjective ? `Objective: ${point.learningObjective}` : "",
        point.assessmentCriteria?.length
          ? `Criteria: ${point.assessmentCriteria.join("; ")}`
          : "",
        point.importance
          ? `Importance: ${point.importance}${point.importanceWeight ? ` (${point.importanceWeight}/5)` : ""}`
          : "",
        point.difficulty ? `Difficulty: ${point.difficulty}` : "",
        point.targetCognitiveLevel
          ? `Target cognitive level: ${point.targetCognitiveLevel}`
          : "",
      ].filter(Boolean);
      return `${point.id}: ${point.label}${details.length ? `\n${details.join("\n")}` : ""}`;
    })
    .join("\n\n");
}
