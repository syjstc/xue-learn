import type { z } from "zod";
import type { quizQuestionSchema } from "../llm/schemas.js";

export const DEFAULT_DIAGNOSTIC_QUESTIONS_PER_TARGET = 2;

export type DiagnosticQuizQuestion = z.infer<typeof quizQuestionSchema>;

export type MissingDiagnosticQuestions = {
  learningTargetId: string;
  count: number;
};

export type DiagnosticQuestionTargets = ReadonlyMap<string, number>;

function targetFor(
  learningTargetId: string,
  targets?: DiagnosticQuestionTargets,
): number {
  return Math.max(
    0,
    Math.round(
      targets?.get(learningTargetId) ?? DEFAULT_DIAGNOSTIC_QUESTIONS_PER_TARGET,
    ),
  );
}

/**
 * Keep only questions that can contribute to the exact diagnostic coverage.
 * Unknown, multi-point, and surplus questions are intentionally discarded.
 */
export function mergeDiagnosticQuestions(
  current: DiagnosticQuizQuestion[],
  candidates: DiagnosticQuizQuestion[],
  learningTargetIds: string[],
  targets?: DiagnosticQuestionTargets,
): DiagnosticQuizQuestion[] {
  const allowed = new Set(learningTargetIds);
  const counts = new Map<string, number>();
  const merged: DiagnosticQuizQuestion[] = [];

  for (const question of [...current, ...candidates]) {
    const ids = question.learningTargetIds ?? [];
    if (ids.length !== 1 || !allowed.has(ids[0])) continue;

    const id = ids[0];
    const count = counts.get(id) ?? 0;
    if (count >= targetFor(id, targets)) continue;

    merged.push(question);
    counts.set(id, count + 1);
  }

  return merged;
}

export function getMissingDiagnosticQuestions(
  questions: DiagnosticQuizQuestion[],
  learningTargetIds: string[],
  targets?: DiagnosticQuestionTargets,
): MissingDiagnosticQuestions[] {
  const counts = new Map<string, number>();
  for (const question of questions) {
    const id = question.learningTargetIds?.[0];
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return learningTargetIds.flatMap((learningTargetId) => {
    const count =
      targetFor(learningTargetId, targets) -
      (counts.get(learningTargetId) ?? 0);
    return count > 0 ? [{ learningTargetId, count }] : [];
  });
}

/** Select only the competency definitions required by a repair request. */
export function selectMissinglearningTargetCompetencies(
  competencyBlock: string,
  missing: MissingDiagnosticQuestions[],
): string {
  const missingIds = new Set(missing.map((item) => item.learningTargetId));
  return competencyBlock
    .split(/\n\s*\n/)
    .filter((block) => {
      const id = block
        .trim()
        .match(/^(lt_\d+)\s*:/i)?.[1]
        ?.toLowerCase();
      return id != null && missingIds.has(id);
    })
    .join("\n\n");
}

export function buildDiagnosticRepairJsonShape(
  missing: MissingDiagnosticQuestions[],
): string {
  const firstId = missing[0]?.learningTargetId ?? "lt_1";
  const secondId = missing[1]?.learningTargetId ?? firstId;
  return `[{"t":"mcq","q":"...","opt":["A","B","C","D"],"ci":0,"lti":["${firstId}"],"pti":"${firstId}","pce":"exact-entity-id","ed":"understanding","cr":"${firstId}:c1","cd":"same"},{"t":"mcq_multi","q":"...","opt":["A","B","C","D"],"cis":[0,2],"lti":["${secondId}"],"pti":"${secondId}","pce":"exact-entity-id","ed":"memory","cr":"${secondId}:c1","cd":"near"}]`;
}

export function buildDiagnosticRepairInstruction(
  missing: MissingDiagnosticQuestions[],
): string {
  const total = missing.reduce((sum, item) => sum + item.count, 0);
  const requirements = missing
    .map(
      ({ learningTargetId, count }) =>
        `- ${learningTargetId}: exactly ${count} additional question${count === 1 ? "" : "s"}`,
    )
    .join("\n");

  return `Generate ONLY these ${total} missing diagnostic questions:
${requirements}
Each returned question must target exactly one listed learning target, and learningTargetIds must contain only that id.
Every question must also include primaryLearningTargetId, primaryCognitiveEntityId using an exact entity id declared for that target and dimension, a memory or understanding dimension, and the exact criterionRef declared by that target, plus an honest contextDistance. Never invent a criterion or claim application/transfer from a selected response.
Use only mcq and mcq_multi, with plausible distractors and no wording clues.
For a point needing two questions, use different recall, comparison, or causal-reasoning angles.
Return only a single minified JSON array.`;
}
