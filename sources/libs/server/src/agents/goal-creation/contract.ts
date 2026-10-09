import { createHash } from "node:crypto";
import { z } from "zod";
import type { PlanningMode } from "../../../../domain/src/index.js";
import type { GoalCreationState } from "./state.js";

export const goalCreationExecutionModes = ["guided", "agentic"] as const;
export type GoalCreationExecutionMode =
  (typeof goalCreationExecutionModes)[number];

export const goalTeachingIntentSchema = z.object({
  targetLevel: z.string().trim().min(1).max(400),
  observableOutcomes: z.array(z.string().trim().min(1).max(400)).min(1).max(16),
  includedScope: z.array(z.string().trim().min(1).max(400)).max(16),
  excludedScope: z.array(z.string().trim().min(1).max(400)).max(16),
  prerequisiteBridges: z.array(z.string().trim().min(1).max(400)).max(16),
});
export type GoalTeachingIntent = z.infer<typeof goalTeachingIntentSchema>;

const discoveryAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(80),
  questionText: z.string().trim().max(2_000).optional(),
  answer: z.union([
    z.string().trim().max(2_000),
    z.array(z.string().trim().max(400)).max(12),
  ]),
});

export const goalCreationContractSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  teachingIntent: goalTeachingIntentSchema.optional(),
  originalRequest: z.string().trim().min(1).max(4_000),
  interpretedOutcome: z.string().trim().min(1).max(2_000),
  includedScope: z.array(z.string().trim().min(1).max(400)).max(16),
  excludedScope: z.array(z.string().trim().min(1).max(400)).max(16),
  level: z.enum(["zero", "basic", "advanced"]),
  learningMode: z.enum(["exploration", "mastery"]),
  planningMode: z.enum(["fast", "deep", "docs_first"]),
  contentLanguage: z.string().trim().min(1).max(32),
  constraints: z.array(z.string().trim().min(1).max(400)).max(16),
  sourceReferences: z
    .array(
      z.object({
        kind: z.enum(["upload", "rag", "web", "planned_goal", "profile"]),
        label: z.string().trim().min(1).max(240),
        contentHash: z.string().trim().min(1).max(128).optional(),
      }),
    )
    .max(32),
  discoveryAnswers: z.array(discoveryAnswerSchema).max(24),
});

export type GoalCreationContract = z.infer<typeof goalCreationContractSchema>;

function sortedStrings(values: readonly string[]): string[] {
  return [...values]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function stableJson(value: unknown): string {
  return formatDeterministicPromptValue(value);
}

export function canonicalizeGoalCreationContract(
  value: unknown,
): GoalCreationContract {
  const parsed = goalCreationContractSchema.parse(value);
  return {
    ...parsed,
    includedScope: sortedStrings(parsed.includedScope),
    excludedScope: sortedStrings(parsed.excludedScope),
    constraints: sortedStrings(parsed.constraints),
    sourceReferences: [...parsed.sourceReferences].sort((left, right) =>
      `${left.kind}:${left.label}`.localeCompare(
        `${right.kind}:${right.label}`,
        "en",
      ),
    ),
    discoveryAnswers: [...parsed.discoveryAnswers].sort((left, right) =>
      left.questionId.localeCompare(right.questionId, "en"),
    ),
  };
}

export function formatDeterministicPromptValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatDeterministicPromptValue(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right, "en"));
  return `{${entries
    .map(
      ([key, nested]) =>
        `${JSON.stringify(key)}:${formatDeterministicPromptValue(nested)}`,
    )
    .join(",")}}`;
}

export function goalCreationContractJson(
  contract: GoalCreationContract,
): string {
  return formatDeterministicPromptValue(
    canonicalizeGoalCreationContract(contract),
  );
}

export function formatGoalCreationContractPrompt(contractJson: string): string {
  try {
    return formatDeterministicPromptValue(JSON.parse(contractJson));
  } catch {
    return contractJson;
  }
}

export function goalCreationContractHash(
  contract: GoalCreationContract,
): string {
  return createHash("sha256")
    .update(goalCreationContractJson(contract))
    .digest("hex");
}

function splitScopeLines(value: string): string[] {
  return value
    .split(/[\n；;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 16);
}

export function compileGoalCreationContract(
  state: GoalCreationState,
): GoalCreationContract {
  const originalRequest = state.topic.trim() || state.refinedTitle.trim();
  if (!originalRequest) {
    throw new Error("Goal creation contract requires an original request");
  }
  const interpretedOutcome =
    state.refinedTitle.trim() || state.intentAnalysis.trim() || originalRequest;
  const constraints = splitScopeLines(state.generationOptions).slice(0, 8);
  const sourceReferences: GoalCreationContract["sourceReferences"] = [];
  if (state.hasDocuments) {
    for (const filename of state.documentFilenames.slice(0, 16)) {
      sourceReferences.push({ kind: "upload", label: filename });
    }
    if (sourceReferences.length === 0) {
      sourceReferences.push({ kind: "upload", label: "uploaded documents" });
    }
  }
  if (state.scopeResearch) {
    sourceReferences.push({
      kind: "web",
      label: "pre-creation scope research",
    });
  }
  if (state.isPlannedGoalActivation) {
    sourceReferences.push({
      kind: "planned_goal",
      label: state.targetSpaceItemId || "planned-goal brief",
    });
  }
  return canonicalizeGoalCreationContract({
    schemaVersion: 2,
    ...(state.teachingIntent ? { teachingIntent: state.teachingIntent } : {}),
    originalRequest,
    interpretedOutcome,
    includedScope:
      state.teachingIntent?.includedScope ??
      splitScopeLines(state.intentAnalysis),
    excludedScope: state.teachingIntent?.excludedScope ?? [],
    level:
      state.level === "basic" || state.level === "advanced"
        ? state.level
        : "zero",
    learningMode:
      state.learningMode === "exploration" ? "exploration" : "mastery",
    planningMode: (["fast", "deep", "docs_first"].includes(state.planningMode)
      ? state.planningMode
      : "deep") as PlanningMode,
    contentLanguage: state.contentLanguage.trim() || "auto",
    constraints,
    sourceReferences,
    discoveryAnswers: state.discoveryAnswers.map((answer) => ({
      questionId: answer.questionId,
      questionText: state.discoveryQuestions.find(
        (question) => question.id === answer.questionId,
      )?.text,
      answer: answer.answer,
    })),
  });
}

export function resolveGoalCreationExecutionMode(input: {
  isSmallCourse: boolean;
  isPlannedGoalActivation: boolean;
  autoApproveWithoutQuestions: boolean;
}): GoalCreationExecutionMode {
  if (input.isSmallCourse) return "guided";
  if (input.autoApproveWithoutQuestions) return "guided";
  return "agentic";
}

/** Full placeholder activations without uploads still use deep research. */
export function resolvePlannedGoalActivationPlanningMode(input: {
  isSmallCourse: boolean;
  hasDocuments: boolean;
  suggestedPlanningMode?: PlanningMode;
}): PlanningMode {
  if (input.isSmallCourse) return "fast";
  if (input.suggestedPlanningMode === "docs_first" && input.hasDocuments) {
    return "docs_first";
  }
  return "deep";
}

/** Planned placeholders already carry intake authority; only confirmation remains. */
export function shouldConfirmPlannedGoalWithoutIntake(
  state: Pick<
    GoalCreationState,
    "isPlannedGoalActivation" | "goalId" | "currentPhase"
  >,
): boolean {
  return (
    state.isPlannedGoalActivation &&
    !state.goalId.trim() &&
    state.currentPhase !== "completed"
  );
}

export function isAgenticGoalCreation(
  state: Pick<
    GoalCreationState,
    "isSmallCourse" | "isPlannedGoalActivation" | "autoApproveWithoutQuestions"
  >,
): boolean {
  return resolveGoalCreationExecutionMode(state) === "agentic";
}
