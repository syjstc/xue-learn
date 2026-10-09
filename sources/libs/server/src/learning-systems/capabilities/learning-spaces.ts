import { z } from "zod";
import { capabilityToolSetFromTools } from "../../agents/core/tool-capability.js";
import { defineAgentTool } from "../../agents/core/tools.js";
import type {
  LearningSpacePortfolio,
  LearningSpacePortfolioReader,
} from "../../learning-spaces/orm-application-service.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../types.js";
import {
  formatPlannedGoalActivationContext,
  plannedGoalBriefSchema,
} from "../../learning-spaces/planned-goal-brief.js";

export const LEARNING_SPACES_CAPABILITY_ID = "learning-spaces" as const;
export const LEARNING_SPACES_CAPABILITY_VERSION = "1.0.1" as const;
export const LEARNING_SPACES_VIEW_KEYS = Object.freeze({
  goalCreationContext: "learning_spaces.goal_creation_context.v1",
});

type GoalCreationSpace = LearningSpacePortfolio["spaces"][number];

const MAX_CONTEXT_ITEMS = 30;
const MAX_CONTEXT_RELATIONS = 30;

function itemLabel(item: GoalCreationSpace["items"][number]): string {
  return item.goal?.title || item.plannedTitle || "Untitled roadmap item";
}

export function buildGoalCreationLearningSpacePrompt(
  space: GoalCreationSpace,
  targetSpaceItemId?: string,
): string {
  const visibleItems = space.items.slice(0, MAX_CONTEXT_ITEMS);
  const visibleItemIds = new Set(visibleItems.map((item) => item.id));
  const itemById = new Map(space.items.map((item) => [item.id, item]));
  const selectedPlaceholder = targetSpaceItemId
    ? space.items.find(
        (item) =>
          item.id === targetSpaceItemId && item.itemType === "planned_goal",
      )
    : undefined;
  const itemLines = visibleItems.map((item, index) => {
    const kind = item.goal
      ? `existing ${item.goal.goalKind} goal; status=${item.goal.status}`
      : `planned ${item.suggestedGoalKind} goal`;
    const rationale = item.rationale?.trim()
      ? `; rationale=${JSON.stringify(item.rationale.trim())}`
      : "";
    const outcome = item.goalBrief?.intendedOutcome
      ? `; intendedOutcome=${JSON.stringify(item.goalBrief.intendedOutcome)}`
      : "";
    const target =
      item.id === targetSpaceItemId ? "; selected placeholder" : "";
    return `${index + 1}. ${JSON.stringify(itemLabel(item))} (${kind}${rationale}${outcome}${target}) [itemId=${item.id}]`;
  });
  const relationLines = space.relations
    .filter(
      (relation) =>
        visibleItemIds.has(relation.fromItemId) &&
        visibleItemIds.has(relation.toItemId),
    )
    .slice(0, MAX_CONTEXT_RELATIONS)
    .map((relation) => {
      const from = itemById.get(relation.fromItemId);
      const to = itemById.get(relation.toItemId);
      return `- ${JSON.stringify(from ? itemLabel(from) : relation.fromItemId)} --${relation.relationType}--> ${JSON.stringify(to ? itemLabel(to) : relation.toItemId)}`;
    });

  return [
    "Learning Space context (server-verified, read-only):",
    `- Name: ${space.name}`,
    `- Purpose: ${space.purpose?.trim() || "Not specified"}`,
    selectedPlaceholder
      ? "The learner started this flow by activating the selected planned-goal placeholder below. Materialize that exact placeholder into its real goal; do not interpret it as a separate new-goal request, compare it against itself for duplication, or say the learner newly typed/proposed it. Use its saved metadata as existing answers. Use other nearby goals, planned goals, and relations only to understand dependencies and identify a genuinely unresolved conflict."
      : "Use this context to make the new goal fit the space's purpose and roadmap. Use nearby goals, planned goals, and relations to avoid duplication, identify likely scope or dependencies, and ask sharper questions when the learner's intent conflicts with or leaves an important roadmap choice ambiguous.",
    "Do not assume an existing goal is completed or that its knowledge is mastered. The space organizes goals; it does not own curriculum, evidence, or learner state. Do not propose workspace changes in this flow.",
    ...(selectedPlaceholder
      ? [
          formatPlannedGoalActivationContext({
            title: selectedPlaceholder.plannedTitle,
            rationale: selectedPlaceholder.rationale,
            suggestedGoalKind: selectedPlaceholder.suggestedGoalKind,
            goalBrief: selectedPlaceholder.goalBrief ?? null,
          }),
        ]
      : []),
    "Roadmap items:",
    ...(itemLines.length ? itemLines : ["(none yet)"]),
    ...(space.items.length > visibleItems.length
      ? [
          `(${space.items.length - visibleItems.length} additional items omitted)`,
        ]
      : []),
    ...(relationLines.length ? ["Roadmap relations:", ...relationLines] : []),
  ].join("\n");
}

function goalCreationSpaceInvocation(
  invocation: unknown,
): { spaceId: string; targetSpaceItemId?: string } | null {
  if (
    !invocation ||
    typeof invocation !== "object" ||
    Array.isArray(invocation)
  ) {
    return null;
  }
  const input = invocation as Record<string, unknown>;
  const spaceId =
    typeof input.goalCreationTargetSpaceId === "string"
      ? input.goalCreationTargetSpaceId.trim()
      : "";
  if (!spaceId) return null;
  const targetSpaceItemId =
    typeof input.goalCreationTargetSpaceItemId === "string"
      ? input.goalCreationTargetSpaceItemId.trim()
      : "";
  return { spaceId, ...(targetSpaceItemId ? { targetSpaceItemId } : {}) };
}

const operationId = z.string().trim().min(1).max(80);
const target = z
  .object({
    spaceId: z.string().trim().min(1).optional(),
    spaceRef: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value.spaceId) !== Boolean(value.spaceRef), {
    message: "Specify exactly one of spaceId or spaceRef.",
  });
const itemTarget = z
  .object({
    itemId: z.string().trim().min(1).optional(),
    itemRef: z.string().trim().min(1).optional(),
    goalId: z.string().trim().min(1).optional(),
  })
  .refine(
    (value) =>
      [value.itemId, value.itemRef, value.goalId].filter(Boolean).length === 1,
    {
      message: "Specify exactly one of itemId, itemRef, or goalId.",
    },
  );

function sameItemTarget(
  left: z.infer<typeof itemTarget>,
  right: z.infer<typeof itemTarget>,
): boolean {
  return (
    (left.itemId !== undefined && left.itemId === right.itemId) ||
    (left.itemRef !== undefined && left.itemRef === right.itemRef) ||
    (left.goalId !== undefined && left.goalId === right.goalId)
  );
}

export const learningSpaceOrganizationProposalSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(600).default(""),
    fingerprint: z.string().max(4000),
    createSpaces: z
      .array(
        z.object({
          operationId,
          ref: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(80),
          purpose: z.string().trim().max(500).default(""),
        }),
      )
      .max(8)
      .default([]),
    updateSpaces: z
      .array(
        z
          .object({
            operationId,
            spaceId: z.string().trim().min(1),
            name: z.string().trim().min(1).max(80).optional(),
            purpose: z.string().trim().max(500).optional(),
            reason: z.string().trim().max(300).default(""),
          })
          .refine(
            (value) => value.name !== undefined || value.purpose !== undefined,
            { message: "An update must change at least one space field." },
          ),
      )
      .max(20)
      .default([]),
    moveGoals: z
      .array(
        z.object({
          operationId,
          goalId: z.string().trim().min(1),
          target,
          includeFoundationGoalIds: z
            .array(z.string().trim().min(1))
            .max(20)
            .default([]),
          reason: z.string().trim().max(300).default(""),
        }),
      )
      .max(50)
      .default([]),
    reorderItems: z
      .array(
        z.object({
          operationId,
          spaceId: z
            .string()
            .trim()
            .min(1)
            .describe(
              "ID of an existing Learning Space, or the ref of a Learning Space created earlier in this proposal.",
            ),
          orderedItemIds: z
            .array(z.string().trim().min(1))
            .min(1)
            .max(100)
            .refine((ids) => new Set(ids).size === ids.length, {
              message:
                "A roadmap order cannot contain the same item more than once.",
            })
            .describe(
              "Distinct existing LearningSpaceItem IDs, goal IDs, or planned-goal refs in preferred order. These identify top-level goals/placeholders in the Learning Space, never curriculum modules, units, lessons, or sections. Planned goals are created before this reorder is applied. Omit this operation when the target space will contain fewer than two items.",
            ),
          reason: z.string().trim().max(300).default(""),
        }),
      )
      .max(50)
      .default([]),
    plannedGoals: z
      .array(
        z.object({
          operationId,
          ref: z.string().trim().min(1).max(80),
          target,
          title: z.string().trim().min(1).max(80),
          rationale: z.string().trim().max(500).default(""),
          suggestedGoalKind: z.enum(["full", "micro"]).default("full"),
          goalBrief: plannedGoalBriefSchema.optional(),
        }),
      )
      .max(20)
      .default([]),
    relations: z
      .array(
        z
          .object({
            operationId,
            target,
            from: itemTarget,
            to: itemTarget,
            relationType: z.enum([
              "prerequisite",
              "supports",
              "follow_up",
              "related",
            ]),
          })
          .refine((relation) => !sameItemTarget(relation.from, relation.to), {
            message: "A roadmap item cannot have a relation to itself.",
          }),
      )
      .max(50)
      .default([]),
  })
  .superRefine((proposal, ctx) => {
    if (proposal.moveGoals.length + proposal.reorderItems.length > 50) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A proposal may contain at most 50 move and reorder operations.",
      });
    }
    const operationIds = [
      ...proposal.createSpaces,
      ...proposal.updateSpaces,
      ...proposal.moveGoals,
      ...proposal.reorderItems,
      ...proposal.plannedGoals,
      ...proposal.relations,
    ].map((operation) => operation.operationId);
    if (new Set(operationIds).size !== operationIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Operation IDs must be unique.",
      });
    }
    const refs = proposal.createSpaces.map((operation) => operation.ref);
    if (new Set(refs).size !== refs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Created-space references must be unique.",
      });
    }
    const itemRefs = proposal.plannedGoals.map((operation) => operation.ref);
    if (new Set(itemRefs).size !== itemRefs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Planned-goal references must be unique.",
      });
    }
  });

export type LearningSpaceOrganizationProposal = z.infer<
  typeof learningSpaceOrganizationProposalSchema
>;

function validateOrganizationProposalAgainstPortfolio(
  proposal: LearningSpaceOrganizationProposal,
  portfolio: LearningSpacePortfolio,
): void {
  if (proposal.fingerprint !== portfolio.fingerprint) {
    throw new Error(
      "fingerprint must exactly match the portfolio returned by get_learning_space_portfolio",
    );
  }

  const existingSpaceKeys = new Set(
    portfolio.spaces.map((space) => `space:${space.id}`),
  );
  const createdSpaceKeys = new Set(
    proposal.createSpaces.map((space) => `ref:${space.ref}`),
  );
  const resolveSpaceKey = (value: {
    spaceId?: string;
    spaceRef?: string;
  }): string => {
    const key = value.spaceRef
      ? `ref:${value.spaceRef}`
      : existingSpaceKeys.has(`space:${value.spaceId}`)
        ? `space:${value.spaceId}`
        : `ref:${value.spaceId}`;
    if (!existingSpaceKeys.has(key) && !createdSpaceKeys.has(key)) {
      throw new Error(
        `unknown Learning Space target: ${value.spaceRef ?? value.spaceId}`,
      );
    }
    return key;
  };

  const canonicalByAlias = new Map<string, string>();
  const membership = new Map<string, string | null>();
  for (const space of portfolio.spaces) {
    const spaceKey = `space:${space.id}`;
    for (const item of space.items) {
      const canonical = item.goalId ? `goal:${item.goalId}` : `item:${item.id}`;
      canonicalByAlias.set(item.id, canonical);
      if (item.goalId) canonicalByAlias.set(item.goalId, canonical);
      membership.set(canonical, spaceKey);
    }
  }
  for (const goal of portfolio.unorganizedGoals) {
    const canonical = `goal:${goal.id}`;
    canonicalByAlias.set(goal.id, canonical);
    membership.set(canonical, null);
  }

  for (const update of proposal.updateSpaces) {
    resolveSpaceKey({ spaceId: update.spaceId });
  }
  for (const move of proposal.moveGoals) {
    const targetSpaceKey = resolveSpaceKey(move.target);
    for (const goalId of [
      move.goalId,
      ...(move.includeFoundationGoalIds ?? []),
    ]) {
      const canonical = canonicalByAlias.get(goalId);
      if (!canonical) throw new Error(`unknown goalId in moveGoals: ${goalId}`);
      membership.set(canonical, targetSpaceKey);
    }
  }
  for (const planned of proposal.plannedGoals) {
    const targetSpaceKey = resolveSpaceKey(planned.target);
    const canonical = `ref:${planned.ref}`;
    canonicalByAlias.set(planned.ref, canonical);
    membership.set(canonical, targetSpaceKey);
  }

  const resolveItemInSpace = (alias: string, spaceKey: string): string => {
    const canonical = canonicalByAlias.get(alias);
    if (!canonical || membership.get(canonical) !== spaceKey) {
      throw new Error(
        `roadmap item ${alias} is unavailable in the proposed Learning Space; use only goal/item IDs from the portfolio or planned-goal refs, never module/unit/lesson IDs`,
      );
    }
    return canonical;
  };

  for (const reorder of proposal.reorderItems) {
    const spaceKey = resolveSpaceKey({ spaceId: reorder.spaceId });
    const availableCount = [...membership.values()].filter(
      (candidate) => candidate === spaceKey,
    ).length;
    if (availableCount < 2) {
      throw new Error(
        "omit reorderItems when the proposed Learning Space contains fewer than two goals/placeholders",
      );
    }
    const ordered = reorder.orderedItemIds.map((alias) =>
      resolveItemInSpace(alias, spaceKey),
    );
    if (new Set(ordered).size !== ordered.length) {
      throw new Error("orderedItemIds resolves to duplicate roadmap items");
    }
  }

  const itemAlias = (value: z.infer<typeof itemTarget>): string =>
    value.itemId ?? value.itemRef ?? value.goalId ?? "";
  for (const relation of proposal.relations) {
    const spaceKey = resolveSpaceKey(relation.target);
    const from = resolveItemInSpace(itemAlias(relation.from), spaceKey);
    const to = resolveItemInSpace(itemAlias(relation.to), spaceKey);
    if (from === to) {
      throw new Error("a roadmap item cannot have a relation to itself");
    }
  }
}

export function createLearningSpacesCapability(
  options: {
    getPortfolio: LearningSpacePortfolioReader;
  } = {
    getPortfolio: async () => {
      throw new Error("Learning Space portfolio reader is not configured.");
    },
  },
) {
  const getPortfolio = options.getPortfolio;
  return defineLearningSystemCapability({
    id: LEARNING_SPACES_CAPABILITY_ID,
    version: LEARNING_SPACES_CAPABILITY_VERSION,
    kind: "learning_system",
    toolSets: [
      capabilityToolSetFromTools({
        key: "learning_spaces.management",
        ownerCapabilityId: LEARNING_SPACES_CAPABILITY_ID,
        ownerCapabilityVersion: LEARNING_SPACES_CAPABILITY_VERSION,
        description:
          "Inspect all Learning Spaces and propose bounded, user-approved creation, update, goal-move, and roadmap changes. Learning Space roadmap items are whole goals or planned-goal placeholders only; curriculum modules, units, lessons, and sections are never space items. Never reorder or relate a single item to itself, and omit reorder/relation operations when a space has only one item.",
        requiredScopes: ["user"],
        tools: [
          defineAgentTool({
            name: "get_learning_space_portfolio",
            description:
              "Read the learner's current Learning Spaces, roadmap items, relations, and unorganized goals before making an organization proposal.",
            schema: z.object({}),
            handler: async (_args, ctx) => getPortfolio(ctx.userId),
          }),
          defineAgentTool({
            name: "propose_learning_space_organization",
            description:
              "Show an exact Learning Space organization preview. Read the portfolio first and use only its LearningSpaceItem IDs/goal IDs plus refs created in this proposal. Do not use curriculum module/unit/lesson/section identities. Every orderedItemIds entry must be distinct, relation endpoints must be different, and a one-item space needs neither reorder nor relation operations. This always pauses for learner approval and never applies changes directly.",
            schema: learningSpaceOrganizationProposalSchema,
            requiresHumanInput: true,
            uiKind: "space_organization_preview",
            validateHumanInput: async (proposal, ctx) => {
              const portfolio = await getPortfolio(ctx.userId);
              validateOrganizationProposalAgainstPortfolio(proposal, portfolio);
            },
            handler: async () => ({ proposed: true }),
          }),
        ],
      }),
    ],
    views: {
      [LEARNING_SPACES_VIEW_KEYS.goalCreationContext]: async ({
        subject,
        invocation,
      }: SystemViewRequest): Promise<ContextEnvelope | null> => {
        if (!subject.userId) return null;
        const target = goalCreationSpaceInvocation(invocation);
        if (!target) return null;
        const space = await getPortfolio(subject.userId).then((portfolio) =>
          portfolio.spaces.find((candidate) => candidate.id === target.spaceId),
        );
        if (!space) return null;
        return {
          ownerCapabilityId: LEARNING_SPACES_CAPABILITY_ID,
          ownerCapabilityVersion: LEARNING_SPACES_CAPABILITY_VERSION,
          schemaVersion: 1,
          authority: "learner_declared_context",
          scope: { userId: subject.userId },
          freshness: { asOf: space.updatedAt, stale: false },
          data: {
            promptBlock: buildGoalCreationLearningSpacePrompt(
              space,
              target.targetSpaceItemId,
            ),
          },
        };
      },
    },
  });
}
