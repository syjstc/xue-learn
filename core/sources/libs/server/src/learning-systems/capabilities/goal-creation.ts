import {
  formatCurrentDatePromptBlock,
  formatCurrentTimePromptBlock,
  queryNeedsExactCurrentTime,
} from "../../assistant/index.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { GOAL_CREATION_VIEW_KEYS } from "../../agents/goal-creation/keys.js";
import { INTAKE_SYSTEM_PROMPT } from "../../agents/goal-creation/subagents/intake/prompt.js";
import { PLAN_SYSTEM_PROMPT } from "../../agents/goal-creation/subagents/plan/prompt.js";
import { MODULE_STRUCTURE_AUDIT_INSTRUCTION } from "../../goal-creation/module-structure-audit.js";
import { requireAgentConversationPersistence } from "../../agents/core/checkpoint.js";
import { goalStateFromCheckpoint } from "../../agents/goal-creation/state.js";
import { formatGoalCreationContractPrompt } from "../../agents/goal-creation/contract.js";
import { serializeMapPlan } from "../../goals/map-plan.js";
import { createIntakeTools } from "../../agents/goal-creation/subagents/intake/tools.js";
import { createPlanTools } from "../../agents/goal-creation/subagents/plan/tools.js";
import { capabilityToolSetFromTools } from "../../agents/core/tool-capability.js";
import { createGlobalAssistantTools } from "../../agents/global-assistant/tools.js";
import type { LearningSpaceGoalCreationApplication } from "../../learning-spaces/orm-application-service.js";

export const GOAL_CREATION_CAPABILITY_ID = "goal-creation" as const;
export const GOAL_CREATION_CAPABILITY_VERSION = "1.0.0" as const;

const PROFILE_SUFFICIENCY_INSTRUCTION = `Profile sufficiency rule:
- Treat Learner profile context as prior user answers, not as optional background.
- Before asking discovery questions or generating a plan, compare the goal with the profile.
- If the profile already answers age/background/field/general skills/known prerequisite levels/preferences, do not ask those again.
- General skills are broad evidence. For example, "math foundations" and "calculus" already answer broad math-foundation questions; only ask about a specific missing prerequisite such as "linear algebra" or "probability and statistics" when that exact prerequisite matters for the goal.
- If an important prerequisite or learner constraint is missing for this goal, ask a targeted discovery question and prefer options that can be saved as knowledge level evidence.
- Use the profile and learner memory for plan, map, course, lesson, practice, and overview personalization.`;

const DOCUMENT_TOPIC_INSTRUCTION = `Extract a learning goal from the uploaded document text and return the declared output contract.
- topic: one sentence describing what the learner wants to learn; it must be usable as a goal.
- refinedTitle: a concise, clear goal title (8–30 characters/words in the document's language).
- intentAnalysis: one sentence describing the learner's intent and expected gain.
- documentSummary: 2–4 sentences covering the document's main subject, structure, and key points.

Use the document's dominant language for the title and descriptions. Do not invent content. If the document is a syllabus or textbook, reflect its central subject rather than a generic label.`;

const SCOPE_INSTRUCTION = `Decide whether the learner's request is one bounded learning goal or a broader portfolio roadmap.
- A single goal has one coherent, demonstrable terminal outcome. Its modules are milestones contributing directly to that outcome.
- Use multiple goals when the request contains independently useful outcomes, meaningfully different prerequisite chains, or distinct learning modes.
- Prefer one reusable Learning Space. Use multiple spaces only for independently durable directions; never use more than three.
- For a roadmap propose 1–12 focused full goals. One proposed goal is valid when organizing it in a reusable Learning Space is useful. Do not propose modules, lessons, curricula, evidence, or mastery state.
- Emit no relation for a one-goal roadmap. Every relation must connect two different proposed goal refs.
- Use existing spaces and roadmap items when they fit. Do not duplicate a real or planned goal already represented in the supplied portfolio.
- A goal brief is non-authoritative and must preserve the learner's original request while giving later intake useful outcome, boundary, prerequisite, output, level, mode, planning, and language defaults.
- Return only the declared structured contract. Never reveal private reasoning.`;

function staticView(
  key: string,
  promptBlock: string,
): NonNullable<
  Parameters<typeof defineLearningSystemCapability>[0]["views"]
>[string] {
  return async ({ subject }) => ({
    ownerCapabilityId: GOAL_CREATION_CAPABILITY_ID,
    ownerCapabilityVersion: GOAL_CREATION_CAPABILITY_VERSION,
    schemaVersion: 1,
    authority: "server_policy",
    scope: { ...subject },
    freshness: { asOf: new Date(0).toISOString(), stale: false },
    data: { promptBlock },
  });
}

export function createGoalCreationCapability(
  options: {
    learningSpaceApplication?: LearningSpaceGoalCreationApplication;
  } = {},
) {
  return defineLearningSystemCapability({
    id: GOAL_CREATION_CAPABILITY_ID,
    version: GOAL_CREATION_CAPABILITY_VERSION,
    kind: "learning_system",
    toolSets: [
      capabilityToolSetFromTools({
        key: "goal_creation.entry",
        ownerCapabilityId: GOAL_CREATION_CAPABILITY_ID,
        ownerCapabilityVersion: GOAL_CREATION_CAPABILITY_VERSION,
        description: "Start or resume the goal-creation workflow.",
        requiredScopes: ["user"],
        tools: createGlobalAssistantTools({
          goalCreationPaused: true,
          selectedToolKeys: ["create_goal", "resume_goal_creation"],
        }),
      }),
      capabilityToolSetFromTools({
        key: "goal_creation.intake",
        ownerCapabilityId: GOAL_CREATION_CAPABILITY_ID,
        ownerCapabilityVersion: GOAL_CREATION_CAPABILITY_VERSION,
        description:
          "Goal intake, discovery, confirmation, creation, and handoff.",
        requiredScopes: ["user", "thread"],
        tools: createIntakeTools(undefined, {
          learningSpaceApplication: options.learningSpaceApplication,
        }),
      }),
      capabilityToolSetFromTools({
        key: "goal_creation.plan",
        ownerCapabilityId: GOAL_CREATION_CAPABILITY_ID,
        ownerCapabilityVersion: GOAL_CREATION_CAPABILITY_VERSION,
        description:
          "Goal plan generation, review, approval, map, overview, and handoff.",
        requiredScopes: ["user", "thread"],
        tools: createPlanTools({
          legacyMapReplacement:
            options.learningSpaceApplication?.legacyMapReplacement,
          overviewCoursePublication:
            options.learningSpaceApplication?.overviewCoursePublication,
          learningGoalPlan: options.learningSpaceApplication?.learningGoalPlan,
          sequentialCurriculumApproval:
            options.learningSpaceApplication?.sequentialCurriculumApproval,
          moduleStructureQueue:
            options.learningSpaceApplication?.moduleStructureQueue,
          cognitiveModelInvalidation:
            options.learningSpaceApplication?.cognitiveModelInvalidation,
        }),
      }),
    ],
    views: {
      [GOAL_CREATION_VIEW_KEYS.intakeInstruction]: staticView(
        GOAL_CREATION_VIEW_KEYS.intakeInstruction,
        INTAKE_SYSTEM_PROMPT,
      ),
      [GOAL_CREATION_VIEW_KEYS.planInstruction]: staticView(
        GOAL_CREATION_VIEW_KEYS.planInstruction,
        PLAN_SYSTEM_PROMPT,
      ),
      [GOAL_CREATION_VIEW_KEYS.scopeInstruction]: staticView(
        GOAL_CREATION_VIEW_KEYS.scopeInstruction,
        SCOPE_INSTRUCTION,
      ),
      [GOAL_CREATION_VIEW_KEYS.profileSufficiency]: staticView(
        GOAL_CREATION_VIEW_KEYS.profileSufficiency,
        PROFILE_SUFFICIENCY_INSTRUCTION,
      ),
      [GOAL_CREATION_VIEW_KEYS.currentTime]: async ({
        subject,
        query,
      }): Promise<ContextEnvelope> => ({
        ownerCapabilityId: GOAL_CREATION_CAPABILITY_ID,
        ownerCapabilityVersion: GOAL_CREATION_CAPABILITY_VERSION,
        schemaVersion: 1,
        authority: "conversation_context",
        scope: { ...subject },
        freshness: { asOf: new Date().toISOString(), stale: false },
        data: {
          promptBlock: queryNeedsExactCurrentTime(query)
            ? formatCurrentTimePromptBlock()
            : formatCurrentDatePromptBlock(),
        },
      }),
      [GOAL_CREATION_VIEW_KEYS.documentTopicInstruction]: staticView(
        GOAL_CREATION_VIEW_KEYS.documentTopicInstruction,
        DOCUMENT_TOPIC_INSTRUCTION,
      ),
      [GOAL_CREATION_VIEW_KEYS.moduleAuditInstruction]: staticView(
        GOAL_CREATION_VIEW_KEYS.moduleAuditInstruction,
        MODULE_STRUCTURE_AUDIT_INSTRUCTION,
      ),
      [GOAL_CREATION_VIEW_KEYS.confirmedContract]: async ({
        subject,
      }): Promise<ContextEnvelope | null> => {
        if (!subject.goalId) return null;
        const session =
          await requireAgentConversationPersistence().findGoalCreationSessionByGoalId(
            subject.goalId,
          );
        if (!session) return null;
        const state = goalStateFromCheckpoint(
          JSON.parse(session.checkpointJson || "{}") as Record<string, unknown>,
        );
        if (!state.contractJson) return null;
        return {
          ownerCapabilityId: GOAL_CREATION_CAPABILITY_ID,
          ownerCapabilityVersion: GOAL_CREATION_CAPABILITY_VERSION,
          schemaVersion: 1,
          authority: "objective_definition",
          scope: { ...subject, goalId: subject.goalId },
          freshness: { asOf: new Date(0).toISOString(), stale: false },
          data: {
            promptBlock: `[Confirmed goal contract]\n${formatGoalCreationContractPrompt(state.contractJson)}`,
          },
        };
      },
      [GOAL_CREATION_VIEW_KEYS.frozenBlueprint]: async ({
        subject,
      }): Promise<ContextEnvelope | null> => {
        if (!subject.goalId) return null;
        const session =
          await requireAgentConversationPersistence().findGoalCreationSessionByGoalId(
            subject.goalId,
          );
        if (!session) return null;
        const state = goalStateFromCheckpoint(
          JSON.parse(session.checkpointJson || "{}") as Record<string, unknown>,
        );
        if (!state.mapPlan) return null;
        return {
          ownerCapabilityId: GOAL_CREATION_CAPABILITY_ID,
          ownerCapabilityVersion: GOAL_CREATION_CAPABILITY_VERSION,
          schemaVersion: 1,
          authority: "objective_definition",
          scope: { ...subject, goalId: subject.goalId },
          freshness: { asOf: new Date(0).toISOString(), stale: false },
          data: {
            promptBlock: `[Frozen complete blueprint]\n${serializeMapPlan(state.mapPlan)}`,
          },
        };
      },
    },
  });
}
