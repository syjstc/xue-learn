import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { retrieveOrSearchWebKnowledge } from "../search/web-knowledge.js";
import type {
  LearningSpaceOrganizationProposal,
  LearningSpacePortfolio,
} from "../learning-spaces/orm-application-service.js";
import { plannedGoalBriefSchema } from "../learning-spaces/planned-goal-brief.js";

const localRef = z.string().trim().min(1).max(80);
const optionalExistingSpaceId = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().trim().min(1).optional(),
);
const scopeSpaceSchema = z
  .object({
    ref: localRef,
    existingSpaceId: optionalExistingSpaceId,
    name: z.string().trim().min(1).max(80),
    purpose: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
const scopeGoalSchema = z
  .object({
    ref: localRef,
    spaceRef: localRef,
    title: z.string().trim().min(1).max(80),
    rationale: z.string().trim().min(1).max(500),
    goalBrief: plannedGoalBriefSchema,
  })
  .strict();
const scopeRelationSchema = z
  .object({
    fromGoalRef: localRef,
    toGoalRef: localRef,
    relationType: z.enum(["prerequisite", "supports", "follow_up", "related"]),
  })
  .strict();

const scopeSpaceBindingSchema = z
  .object({
    ref: localRef,
    existingSpaceId: z.string().trim().optional(),
    name: z.string().trim().min(1).max(80),
    purpose: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();

export const goalScopeAssessmentBindingSchema = z
  .object({
    decision: z.enum(["single_goal", "multi_goal", "existing_roadmap"]),
    rationale: z.string().trim().min(1).max(800),
    existingSpaceId: z.string().trim().optional(),
    spaces: z.array(scopeSpaceBindingSchema).max(3).default([]),
    goals: z.array(scopeGoalSchema).max(12).default([]),
    relations: z.array(scopeRelationSchema).max(30).default([]),
    recommendedFirstGoalRef: localRef.optional(),
  })
  .strict();

function normalizeGoalScopeGeneratedValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  const goals = Array.isArray(root.goals) ? root.goals : [];
  const goalRefs = new Set(
    goals.flatMap((goal) => {
      if (!goal || typeof goal !== "object" || Array.isArray(goal)) return [];
      const ref = (goal as Record<string, unknown>).ref;
      return typeof ref === "string" && ref.trim() ? [ref.trim()] : [];
    }),
  );
  const relations = Array.isArray(root.relations)
    ? root.relations.filter((relation) => {
        if (
          !relation ||
          typeof relation !== "object" ||
          Array.isArray(relation)
        ) {
          return true;
        }
        const record = relation as Record<string, unknown>;
        const from =
          typeof record.fromGoalRef === "string"
            ? record.fromGoalRef.trim()
            : "";
        const to =
          typeof record.toGoalRef === "string" ? record.toGoalRef.trim() : "";
        return (
          !from ||
          !to ||
          (from !== to && goalRefs.has(from) && goalRefs.has(to))
        );
      })
    : root.relations;
  const recommendedFirstGoalRef =
    typeof root.recommendedFirstGoalRef === "string" &&
    goalRefs.has(root.recommendedFirstGoalRef.trim())
      ? root.recommendedFirstGoalRef
      : undefined;
  return {
    ...root,
    existingSpaceId:
      typeof root.existingSpaceId === "string" &&
      root.existingSpaceId.trim().length === 0
        ? undefined
        : root.existingSpaceId,
    spaces: Array.isArray(root.spaces)
      ? root.spaces.map((space) => {
          if (!space || typeof space !== "object" || Array.isArray(space)) {
            return space;
          }
          const record = space as Record<string, unknown>;
          return {
            ...record,
            existingSpaceId:
              typeof record.existingSpaceId === "string" &&
              record.existingSpaceId.trim().length === 0
                ? undefined
                : record.existingSpaceId,
          };
        })
      : root.spaces,
    relations,
    recommendedFirstGoalRef,
  };
}

const goalScopeAssessmentFieldsSchema = z
  .object({
    decision: z.enum(["single_goal", "multi_goal", "existing_roadmap"]),
    rationale: z.string().trim().min(1).max(800),
    existingSpaceId: optionalExistingSpaceId,
    spaces: z.array(scopeSpaceSchema).max(3).default([]),
    goals: z.array(scopeGoalSchema).max(12).default([]),
    relations: z.array(scopeRelationSchema).max(30).default([]),
    recommendedFirstGoalRef: localRef.optional(),
  })
  .strict();

export const goalScopeAssessmentSchema = z
  .preprocess(normalizeGoalScopeGeneratedValue, goalScopeAssessmentFieldsSchema)
  .superRefine((value, ctx) => {
    if (value.decision !== "multi_goal") return;
    if (value.spaces.length < 1 || value.goals.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A roadmap requires 1–3 spaces and 1–12 proposed goals.",
      });
    }
    const spaceRefs = new Set(value.spaces.map((space) => space.ref));
    const goalRefs = new Set(value.goals.map((goal) => goal.ref));
    if (
      spaceRefs.size !== value.spaces.length ||
      goalRefs.size !== value.goals.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Space and goal refs must be unique.",
      });
    }
    for (const goal of value.goals) {
      if (!spaceRefs.has(goal.spaceRef)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown space ref: ${goal.spaceRef}`,
        });
      }
    }
    for (const relation of value.relations) {
      if (
        !goalRefs.has(relation.fromGoalRef) ||
        !goalRefs.has(relation.toGoalRef)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Relations must reference proposed goals.",
        });
      }
    }
    if (
      value.recommendedFirstGoalRef &&
      !goalRefs.has(value.recommendedFirstGoalRef)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The recommended first goal must reference a proposed goal.",
      });
    }
  });

export type GoalScopeAssessment = z.infer<typeof goalScopeAssessmentSchema>;

export type GoalScopeResearch = Readonly<{
  context: string;
  sources: readonly Readonly<{ title: string; url: string; snippet: string }>[];
}>;

export class GoalScopeAssessmentError extends Error {
  constructor(
    readonly research: GoalScopeResearch,
    cause: unknown,
  ) {
    super(
      cause instanceof Error ? cause.message : "Goal scope assessment failed.",
    );
    this.name = "GoalScopeAssessmentError";
  }
}

function compactPortfolio(portfolio: LearningSpacePortfolio) {
  return {
    fingerprint: portfolio.fingerprint,
    spaces: portfolio.spaces.slice(0, 20).map((space) => ({
      id: space.id,
      name: space.name,
      purpose: space.purpose,
      items: space.items.slice(0, 40).map((item) => ({
        id: item.id,
        itemType: item.itemType,
        title: item.goal?.title || item.plannedTitle,
        rationale: item.rationale,
        intendedOutcome: item.goalBrief?.intendedOutcome ?? "",
      })),
      relations: space.relations.slice(0, 50),
    })),
    unorganizedGoals: portfolio.unorganizedGoals.slice(0, 30).map((goal) => ({
      id: goal.id,
      title: goal.title,
      status: goal.status,
    })),
  };
}

export async function assessGoalScope(input: {
  userId: string;
  threadId: string;
  topic: string;
  refinedTitle: string;
  intentAnalysis: string;
  generationOptions: string;
  level: string;
  contentLanguage: string;
  learningMode: string;
  planningMode: string;
  portfolio: LearningSpacePortfolio;
  signal?: AbortSignal;
  onActivity?: Parameters<typeof retrieveOrSearchWebKnowledge>[0]["onActivity"];
}): Promise<{ assessment: GoalScopeAssessment; research: GoalScopeResearch }> {
  const search = await retrieveOrSearchWebKnowledge({
    userId: input.userId,
    query: `${input.refinedTitle || input.topic} key concepts scope learning roadmap`,
    reason:
      "Check whether this topic is one bounded goal or a broader learning roadmap.",
    forceSearch: true,
    freshnessClass: "normal",
    searchPurpose: "map",
    resultCount: 5,
    onActivity: input.onActivity,
  }).catch(() => null);
  const research: GoalScopeResearch = {
    context: search?.context ?? "",
    sources: (search?.sources ?? []).map((source) => ({
      title: source.title,
      url: source.url ?? "",
      snippet: source.excerpt ?? "",
    })),
  };
  const prompt = JSON.stringify({
    learnerRequest: {
      topic: input.topic,
      refinedTitle: input.refinedTitle,
      intentAnalysis: input.intentAnalysis,
      generationOptions: input.generationOptions,
      level: input.level,
      contentLanguage: input.contentLanguage,
      learningMode: input.learningMode,
      planningMode: input.planningMode,
    },
    portfolio: compactPortfolio(input.portfolio),
    topicLandscapeResearch: research.context.slice(0, 12_000),
  });
  let generatedAssessment: GoalScopeAssessment;
  try {
    generatedAssessment = await runValidatedStructuredGeneration(
      {
        mode: "object",
        schema: goalScopeAssessmentSchema,
        prompt,
        options: {
          operation: "agent.goal_creation.scope",
          bindingSchema: goalScopeAssessmentBindingSchema,
          schemaShape:
            "Return exactly the declared scope assessment fields; do not rename fields or add a response/message field. Every proposed goal must include spaceRef matching one spaces[].ref and a complete goalBrief using schemaVersion, originalRequest, intendedOutcome, scopeIncluded, scopeExcluded, prerequisites, desiredOutputs, suggestedLevel, suggestedLearningMode, suggestedPlanningMode, and suggestedContentLanguage. A multi_goal roadmap may contain 1–3 spaces and 1–12 goals; one proposed goal is valid when the useful outcome is organizing it in a Learning Space. Relations must be empty unless they connect two different proposed goals. Use semantic local refs only; copy server IDs only into existingSpaceId.",
          deepseekStrictOnly: true,
          meta: { threadId: input.threadId },
        },
        contextSubject: { userId: input.userId, threadId: input.threadId },
        contextQuery: input.topic.slice(0, 2_000),
      },
      { signal: input.signal },
    );
  } catch (error) {
    throw new GoalScopeAssessmentError(research, error);
  }
  const ownedSpaceIds = new Set(
    input.portfolio.spaces.map((space) => space.id),
  );
  const assessment: GoalScopeAssessment = {
    ...generatedAssessment,
    existingSpaceId:
      generatedAssessment.existingSpaceId &&
      ownedSpaceIds.has(generatedAssessment.existingSpaceId)
        ? generatedAssessment.existingSpaceId
        : undefined,
    spaces: generatedAssessment.spaces.map((space) => ({
      ...space,
      existingSpaceId:
        space.existingSpaceId && ownedSpaceIds.has(space.existingSpaceId)
          ? space.existingSpaceId
          : undefined,
    })),
  };
  return { assessment, research };
}

function normalizedTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("und");
}

export function compileGoalScopeProposal(
  assessment: GoalScopeAssessment,
  portfolio: LearningSpacePortfolio,
): LearningSpaceOrganizationProposal | null {
  if (assessment.decision !== "multi_goal") return null;
  const existingSpaces = new Map(
    portfolio.spaces.map((space) => [space.id, space]),
  );
  const spaceByRef = new Map(
    assessment.spaces.map((space) => [space.ref, space]),
  );
  const usableSpaces = assessment.spaces.filter(
    (space) =>
      !space.existingSpaceId || existingSpaces.has(space.existingSpaceId),
  );
  if (usableSpaces.length === 0) return null;
  const usableSpaceRefs = new Set(usableSpaces.map((space) => space.ref));
  const seenTitles = new Set([
    ...portfolio.spaces.flatMap((space) =>
      space.items.map((item) =>
        normalizedTitle(item.goal?.title || item.plannedTitle),
      ),
    ),
    ...portfolio.unorganizedGoals.map((goal) => normalizedTitle(goal.title)),
  ]);
  const goals = assessment.goals.filter((goal) => {
    if (!usableSpaceRefs.has(goal.spaceRef)) return false;
    const title = normalizedTitle(goal.title);
    if (seenTitles.has(title)) return false;
    seenTitles.add(title);
    return true;
  });
  if (goals.length < 1) return null;

  const createSpaces = usableSpaces.flatMap((space) =>
    space.existingSpaceId
      ? []
      : [
          {
            operationId: `create-space-${randomUUID()}`,
            ref: space.ref,
            name: space.name,
            purpose: space.purpose,
          },
        ],
  );
  const updateSpaces = usableSpaces.flatMap((space) => {
    const existing = space.existingSpaceId
      ? existingSpaces.get(space.existingSpaceId)
      : undefined;
    if (!existing || existing.purpose.trim() === space.purpose.trim())
      return [];
    return [
      {
        operationId: `update-space-${randomUUID()}`,
        spaceId: existing.id,
        purpose: space.purpose,
        reason: space.reason,
      },
    ];
  });
  const targetForSpace = (ref: string) => {
    const space = spaceByRef.get(ref)!;
    return space.existingSpaceId
      ? { spaceId: space.existingSpaceId }
      : { spaceRef: space.ref };
  };
  const plannedGoals = goals.map((goal) => ({
    operationId: `planned-goal-${randomUUID()}`,
    ref: goal.ref,
    target: targetForSpace(goal.spaceRef),
    title: goal.title,
    rationale: goal.rationale,
    suggestedGoalKind: "full",
    goalBrief: goal.goalBrief,
  }));
  const goalsByRef = new Map(goals.map((goal) => [goal.ref, goal]));
  const relations = assessment.relations.flatMap((relation) => {
    const from = goalsByRef.get(relation.fromGoalRef);
    const to = goalsByRef.get(relation.toGoalRef);
    if (!from || !to || from.ref === to.ref || from.spaceRef !== to.spaceRef)
      return [];
    return [
      {
        operationId: `relation-${randomUUID()}`,
        target: targetForSpace(from.spaceRef),
        from: { itemRef: from.ref },
        to: { itemRef: to.ref },
        relationType: relation.relationType,
      },
    ];
  });
  return {
    fingerprint: portfolio.fingerprint,
    createSpaces,
    updateSpaces,
    moveGoals: [],
    reorderItems: [],
    plannedGoals,
    relations,
  };
}

export function selectGoalScopeProposal(
  proposal: LearningSpaceOrganizationProposal,
  selectedGoalRefs: readonly string[],
): { proposal: LearningSpaceOrganizationProposal; operationIds: string[] } {
  const selected = new Set(selectedGoalRefs);
  const plannedGoals = proposal.plannedGoals.filter((goal) =>
    selected.has(goal.ref),
  );
  if (plannedGoals.length < 1) {
    throw new Error("Select at least one planned goal to save a roadmap.");
  }
  const selectedRefs = new Set(plannedGoals.map((goal) => goal.ref));
  const spaceRefs = new Set(
    plannedGoals.flatMap((goal) =>
      goal.target.spaceRef ? [goal.target.spaceRef] : [],
    ),
  );
  const spaceIds = new Set(
    plannedGoals.flatMap((goal) =>
      goal.target.spaceId ? [goal.target.spaceId] : [],
    ),
  );
  const createSpaces = proposal.createSpaces.filter((space) =>
    spaceRefs.has(space.ref),
  );
  const updateSpaces = proposal.updateSpaces.filter((space) =>
    spaceIds.has(space.spaceId),
  );
  const relations = proposal.relations.filter(
    (relation) =>
      (!relation.from.itemRef || selectedRefs.has(relation.from.itemRef)) &&
      (!relation.to.itemRef || selectedRefs.has(relation.to.itemRef)),
  );
  const selectedProposal = {
    ...proposal,
    createSpaces,
    updateSpaces,
    plannedGoals,
    relations,
    reorderItems: [],
  };
  return {
    proposal: selectedProposal,
    operationIds: [
      ...createSpaces,
      ...updateSpaces,
      ...plannedGoals,
      ...relations,
    ].map((operation) => operation.operationId),
  };
}
