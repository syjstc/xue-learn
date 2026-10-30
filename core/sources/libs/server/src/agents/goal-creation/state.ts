import type {
  GoalMapPlan,
  GoalMapSummary,
} from "../../llm/schemas.js";
import type { AgentPhase, AgentSubagent } from "../core/types.js";
import {
  learnerFacingGoalInstructions,
  type PlanningMode,
} from "../../../../domain/src/index.js";
import type {
  GoalScopeAssessment,
  GoalScopeResearch,
} from "../../goal-creation/scope-assessment.js";
import type { LearningSpaceOrganizationProposal } from "../../learning-spaces/orm-application-service.js";
import type { GoalTeachingIntent, GoalCreationExecutionMode } from "./contract.js";

export type DiscoveryQuestion = {
  id: string;
  text: string;
  hint?: string;
  answerKind: "text" | "single_choice" | "multi_choice";
  choices?: string[];
};

export type DiscoveryAnswer = {
  questionId: string;
  answer: string | string[];
};

export type CollectFormField =
  "level" | "contentLanguage" | "isSmallCourse" | "documents";

export type GoalSpaceSuggestion = {
  name: string;
  purpose: string;
  reason: string;
};

export type GoalCreationDraft = {
  topic?: string;
  level?: "zero" | "basic" | "advanced";
  targetSpaceId?: string;
  targetSpaceItemId?: string;
};

export type GoalCreationState = {
  teachingIntent?: GoalTeachingIntent;
  teachingIntentSourceHash?: string;
  topic: string;
  refinedTitle: string;
  intentAnalysis: string;
  isVague: boolean;
  discoveryQuestions: DiscoveryQuestion[];
  discoveryAnswers: DiscoveryAnswer[];
  discoverySkipped: boolean;
  intakeWebSearchAttempted?: boolean;
  level: string;
  contentLanguage: string;
  /** Learner-authored messages used only to resolve the automatic language. */
  contentLanguageSourceText: string;
  generationOptions: string;
  isSmallCourse: boolean;
  planningMode: PlanningMode;
  learningMode: "exploration" | "mastery";
  hasDocuments: boolean;
  documentFilenames: string[];
  goalId: string;
  /** True after the learner approves `show_confirmation`, even before `goalId` exists. */
  goalApproved: boolean;
  mapSummary: GoalMapSummary | null;
  mapSummaryStatus: string;
  mapPlan: GoalMapPlan | null;
  mapPlanStatus: string;
  currentPhase: AgentPhase;
  currentSubagent: AgentSubagent;
  collectedFields: string[];
  autoApproveWithoutQuestions: boolean;
  parentGoalId: string;
  goalRelationType: string;
  goalRelationContext: Record<string, unknown> | null;
  targetSpaceId: string;
  targetSpaceItemId: string;
  /** True when this run materializes an existing roadmap placeholder. */
  isPlannedGoalActivation: boolean;
  spaceSuggestion: GoalSpaceSuggestion | null;
  spaceSuggestionStatus: "pending" | "accepted" | "skipped";
  scopeStatus:
    | "pending"
    | "single_goal"
    | "multi_goal"
    | "existing_roadmap"
    | "skipped"
    | "failed";
  scopeAssessment: GoalScopeAssessment | null;
  scopeProposal: LearningSpaceOrganizationProposal | null;
  scopePortfolioFingerprint: string;
  scopeResearch: GoalScopeResearch | null;
  executionMode: GoalCreationExecutionMode;
  contractJson: string;
  contractHash: string;
  planAuthorAttempts: number;
  planRepairAttempts: number;
  moduleAuditRepairRound: number;
  auditStatus: "idle" | "pending" | "passed" | "repairing" | "failed";
};

export function createInitialGoalState(): GoalCreationState {
  return {
    topic: "",
    refinedTitle: "",
    intentAnalysis: "",
    isVague: false,
    discoveryQuestions: [],
    discoveryAnswers: [],
    discoverySkipped: false,
    level: "zero",
    contentLanguage: "auto",
    contentLanguageSourceText: "",
    generationOptions: "",
    isSmallCourse: false,
    planningMode: "deep",
    learningMode: "mastery",
    hasDocuments: false,
    documentFilenames: [],
    goalId: "",
    goalApproved: false,
    mapSummary: null,
    mapSummaryStatus: "pending",
    mapPlan: null,
    mapPlanStatus: "pending",
    currentPhase: "parsing",
    currentSubagent: "intake",
    collectedFields: [],
    autoApproveWithoutQuestions: false,
    parentGoalId: "",
    goalRelationType: "",
    goalRelationContext: null,
    targetSpaceId: "",
    targetSpaceItemId: "",
    isPlannedGoalActivation: false,
    spaceSuggestion: null,
    spaceSuggestionStatus: "pending",
    scopeStatus: "pending",
    scopeAssessment: null,
    scopeProposal: null,
    scopePortfolioFingerprint: "",
    scopeResearch: null,
    executionMode: "agentic",
    contractJson: "",
    contractHash: "",
    planAuthorAttempts: 0,
    planRepairAttempts: 0,
    moduleAuditRepairRound: 0,
    auditStatus: "idle",
  };
}

/** Keep server-owned activation metadata in the checkpoint, not learner UI. */
export function goalStateForLearner(
  state: GoalCreationState,
): GoalCreationState {
  return {
    ...state,
    generationOptions: learnerFacingGoalInstructions(state.generationOptions),
  };
}

function isGoalStateShape(value: Record<string, unknown>): boolean {
  return (
    "currentPhase" in value ||
    "currentSubagent" in value ||
    "topic" in value ||
    "goalId" in value ||
    "discoveryQuestions" in value ||
    "discoveryAnswers" in value ||
    "collectedFields" in value ||
    "generationOptions" in value
  );
}

function asGoalStatePartial(
  value: unknown,
): Partial<GoalCreationState> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Partial<GoalCreationState>;
}

function normalizeGoalStateArrays(state: GoalCreationState): GoalCreationState {
  return {
    ...state,
    discoveryQuestions: Array.isArray(state.discoveryQuestions)
      ? state.discoveryQuestions
      : [],
    discoveryAnswers: Array.isArray(state.discoveryAnswers)
      ? state.discoveryAnswers
      : [],
    collectedFields: Array.isArray(state.collectedFields)
      ? state.collectedFields
      : [],
    documentFilenames: Array.isArray(state.documentFilenames)
      ? state.documentFilenames
      : [],
  };
}

/** Read goal state from a thread checkpoint or from the live `ctx.state` object. */
export function goalStateFromCheckpoint(
  checkpoint: Record<string, unknown>,
): GoalCreationState {
  const nested = asGoalStatePartial(checkpoint.goalState);
  const partial =
    nested ??
    (isGoalStateShape(checkpoint) ? asGoalStatePartial(checkpoint) : undefined);
  return normalizeGoalStateArrays({
    ...createInitialGoalState(),
    ...partial,
  });
}

/** Scope save/cancel finished without creating a real LearningGoal. */
export function isGoalCreationClosedWithoutGoal(
  checkpoint: Record<string, unknown>,
): boolean {
  const state = goalStateFromCheckpoint(checkpoint);
  return state.currentPhase === "completed" && !state.goalId.trim();
}

export function mergeGoalState(
  checkpoint: Record<string, unknown>,
  patch: Partial<GoalCreationState>,
): Record<string, unknown> {
  const current = goalStateFromCheckpoint(checkpoint);
  return { ...checkpoint, goalState: { ...current, ...patch } };
}

function normalizedTopicContext(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("und");
}

/**
 * Preserve the learner's original goal while adding clarification context.
 * Clarification cards may return short dependent answers such as “all of it”;
 * replacing the topic with that answer would leave the later scope assessment
 * without the subject being clarified.
 */
export function mergeGoalTopicContext(
  currentValue: string,
  clarificationValue: string,
): string {
  const current = currentValue.trim();
  const clarification = clarificationValue.trim();
  if (!current) return clarification;
  if (!clarification) return current;

  const normalizedCurrent = normalizedTopicContext(current);
  const normalizedClarification = normalizedTopicContext(clarification);
  if (normalizedCurrent === normalizedClarification) return current;
  if (normalizedClarification.includes(normalizedCurrent)) {
    return clarification;
  }
  if (normalizedCurrent.includes(normalizedClarification)) return current;
  return `${current}；${clarification}`;
}

export function applyGoalCreationDraft<T extends Record<string, unknown>>(
  checkpoint: T,
  draft: GoalCreationDraft,
): T {
  const current = goalStateFromCheckpoint(checkpoint);
  const collectedFields = new Set(current.collectedFields);
  const patch: Partial<GoalCreationState> = {};
  const topic = draft.topic?.trim();
  if (topic) {
    patch.topic = topic;
    patch.contentLanguageSourceText = topic;
  }
  if (
    draft.level === "zero" ||
    draft.level === "basic" ||
    draft.level === "advanced"
  ) {
    patch.level = draft.level;
    collectedFields.add("level");
  }
  if (draft.targetSpaceId?.trim()) {
    patch.targetSpaceId = draft.targetSpaceId.trim();
  }
  if (draft.targetSpaceItemId?.trim()) {
    patch.targetSpaceItemId = draft.targetSpaceItemId.trim();
  }
  patch.collectedFields = [...collectedFields];
  return mergeGoalState(checkpoint, patch) as T;
}
