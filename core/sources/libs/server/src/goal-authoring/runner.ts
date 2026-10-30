import { createHash } from "node:crypto";
import { boundedToolCallId } from "../agents/core/tool-call-id.js";
import { formatDeterministicPromptValue } from "../agents/goal-creation/contract.js";
import { z } from "zod";
import {
  goalCurriculumIdentityBindingSchema,
  goalCurriculumJourneyBindingSchema,
} from "../llm/schemas.js";
import {
  explorationModuleStructureProposalSchema,
  moduleCapabilityProposalSchema,
  moduleStructureProposalSchema,
} from "../learning-systems/capabilities/module-curriculum.js";
import { moduleStructureAuditResultSchema } from "../goal-creation/module-structure-audit.js";
import { teachingSkillSelectionSchema } from "../teaching-skills/resolver.js";
import {
  runUnitAuthoringAgentRound,
  splitUnitAuthoringBootstrapPrompt,
} from "../unit-authoring/agent-round.js";
import type { LlmMessageRecord } from "../agents/core/types.js";
import { runWithLlmTraceAsync } from "../llm/trace-context.js";
import {
  appendGoalAuthoringMessage,
  ensureGoalAuthoringSession,
  findAcceptedGoalAuthoringIdentity,
  loadGoalAuthoringMessages,
  saveGoalAuthoringState,
  seedGoalAuthoringBranch,
} from "./session.js";
import { goalPathPartBindingSchema } from "./path-parts.js";

export const GOAL_AUTHORING_OPERATION = "goal.authoring_agent";
const GOAL_AUTHORING_SYSTEM_PROMPT = `You are XueLearn's durable goal-authoring agent. Continue one learner-confirmed goal from contract through blueprint and module branches. Use exactly one requested commit tool per turn. Treat committed tool results as authoritative, keep module research isolated to its branch, and never reveal private reasoning.`;

const goalContractCommitSchema = z.object({
  contract: z.record(z.string(), z.unknown()),
});
export const goalAuthoringToolCatalog = Object.freeze([
  {
    name: "commit_goal_contract",
    description: "Commit the learner-confirmed goal contract.",
    schema: goalContractCommitSchema,
  },
  {
    name: "commit_goal_teaching_skill",
    description:
      "Commit the domain-teaching skill selection for the confirmed goal.",
    schema: teachingSkillSelectionSchema,
  },
  {
    name: "commit_goal_identity",
    description:
      "Commit the frozen goal identity with schemaVersion: 2 (never 1), domainAnalysis, topicOverview, whatYouWillLearn, and prerequisitesAssumed as direct top-level arguments; do not wrap them or include modules.",
    schema: goalCurriculumIdentityBindingSchema,
  },
  {
    name: "commit_goal_journey",
    description:
      "Commit modules[] summaries and the complete learningPath with KACOM identities, baseline assumptions, goal outcome requirements, every module/unit contract and explicit prerequisite sources. Do not author lesson content or learner mastery.",
    schema: goalCurriculumJourneyBindingSchema,
  },
  {
    name: "commit_goal_path_part",
    description: "Commit only the requested goal-path part: outline, registry, or one module. Keep this tool across all path turns. Never repeat previously accepted parts or emit the complete path.",
    schema: goalPathPartBindingSchema,
  },
  {
    name: "commit_module_capabilities",
    description: "Commit one module's exit capabilities.",
    schema: moduleCapabilityProposalSchema,
  },
  {
    name: "commit_module_structure",
    description: "Commit one mastery module structure. Both top-level units and coverageRationale are required. coverageRationale must explain in a non-empty string how these lessons cover every exit capability; do not omit it or place it inside a unit.",
    schema: moduleStructureProposalSchema,
  },
  {
    name: "commit_exploration_module_structure",
    description: "Commit one exploration module structure. Both top-level units and coverageRationale are required; explain in coverageRationale how the ordered lessons cover the approved scope.",
    schema: explorationModuleStructureProposalSchema,
  },
  {
    name: "commit_module_audit",
    description: "Commit the whole-goal module audit.",
    schema: moduleStructureAuditResultSchema,
  },
] as const);

export async function seedGoalAuthoringContract(input: {
  userId: string;
  goalId: string;
  userRequest: string;
  contract: Record<string, unknown>;
  traceId: string;
}) {
  const session = await ensureGoalAuthoringSession(input);
  const existing = await loadGoalAuthoringMessages(session.threadId);
  const latestContract = existing
    .flatMap((message) => message.toolCalls ?? [])
    .filter((call) => call.name === "commit_goal_contract")
    .at(-1);
  const serialized = formatDeterministicPromptValue(input.contract);
  if (
    latestContract &&
    formatDeterministicPromptValue(latestContract.args.contract) === serialized
  )
    return;
  const revision = createHash("sha256")
    .update(serialized)
    .digest("hex")
    .slice(0, 16);
  const callId = boundedToolCallId(`goal-contract-${input.goalId}-${revision}`);
  const messages: LlmMessageRecord[] = [
    ...(existing.length === 0
      ? [{ role: "system" as const, content: GOAL_AUTHORING_SYSTEM_PROMPT }]
      : []),
    {
      role: "user",
      content: `${existing.length ? "Updated goal requirements: the following contract supersedes conflicting older requirements. Revalidate the blueprint and dependent lessons; preserve unaffected learner requirements.\n" : ""}${input.userRequest.trim()}`,
    },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: callId,
          name: "commit_goal_contract",
          args: { contract: input.contract },
        },
      ],
    },
    {
      role: "tool",
      toolCallId: callId,
      content: JSON.stringify({
        status: "accepted",
        tool: "commit_goal_contract",
      }),
    },
  ];
  for (const message of messages) {
    await appendGoalAuthoringMessage({
      threadId: session.threadId,
      message,
      branchKind: "main",
    });
  }
  await saveGoalAuthoringState(session.threadId, {
    ...session.state,
    blueprintMessageId: null,
    checkpoints: {},
  });
}

export async function ensureGoalAuthoringTeachingSkillFallback(input: {
  userId: string;
  goalId: string;
  reason: string;
}) {
  const session = await ensureGoalAuthoringSession(input);
  const transcript = await loadGoalAuthoringMessages(session.threadId);
  if (
    transcript.some((message) =>
      message.toolCalls?.some(
        (call) => call.name === "commit_goal_teaching_skill",
      ),
    )
  ) {
    return;
  }
  const callId = boundedToolCallId(`goal-teaching-skill-${input.goalId}`);
  for (const message of [
    {
      role: "user" as const,
      content:
        "Record the deterministic teaching-skill fallback for this confirmed goal.",
    },
    {
      role: "assistant" as const,
      content: "",
      toolCalls: [
        {
          id: callId,
          name: "commit_goal_teaching_skill",
          args: { skills: [], reason: input.reason },
        },
      ],
    },
    {
      role: "tool" as const,
      toolCallId: callId,
      content: JSON.stringify({
        status: "accepted",
        tool: "commit_goal_teaching_skill",
      }),
    },
  ]) {
    await appendGoalAuthoringMessage({
      threadId: session.threadId,
      message,
      branchKind: "main",
    });
  }
}

async function persistRound(
  threadId: string,
  branchKind: "main" | "module" | "audit" | "repair",
  round: {
    repairMessages: readonly LlmMessageRecord[];
    userMessage: LlmMessageRecord;
    assistantMessage: LlmMessageRecord;
    toolMessage: LlmMessageRecord;
  },
) {
  for (const message of round.repairMessages) {
    await appendGoalAuthoringMessage({
      threadId,
      message,
      branchKind: "repair",
    });
  }
  let lastMessageId: string | null = null;
  for (const message of [
    round.userMessage,
    round.assistantMessage,
    round.toolMessage,
  ]) {
    const row = await appendGoalAuthoringMessage({
      threadId,
      message,
      branchKind,
    });
    lastMessageId = row.id;
  }
  return lastMessageId;
}

/** Host-owned authoring constraints are injected without importing a product policy. */
export type GoalAuthoringPolicy = {
  prompt(prompt: string, expectedTool: string): string;
  schema<T>(schema: z.ZodType<T>, expectedTool: string): z.ZodType<T>;
};
export async function runGoalAuthoringRound<TResult>(input: {
  userId: string;
  goalId: string;
  branchId?: string;
  expectedTool: string;
  authoringPolicy?: GoalAuthoringPolicy;
  prompt: string;
  resultSchema: z.ZodType<TResult>;
  operation: string;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  onToken?: (delta: string) => void | Promise<void>;
  onPartialCandidate?: (candidate: unknown) => void | Promise<void>;
  /** Reuse an accepted stage within this confirmed goal contract. */
  checkpointKey?: string;
  markBlueprint?: boolean;
  maxRepairAttempts?: number;
  repairInstruction?: string;
}) {
  input.signal?.throwIfAborted();
  const prompt = input.authoringPolicy?.prompt(input.prompt, input.expectedTool) ?? input.prompt;
  const resultSchema = input.authoringPolicy?.schema(input.resultSchema, input.expectedTool) ?? input.resultSchema;
  const session = input.branchId
    ? await seedGoalAuthoringBranch({
        userId: input.userId,
        goalId: input.goalId,
        branchId: input.branchId,
      })
    : {
        ...(await ensureGoalAuthoringSession(input)),
        messages: [] as LlmMessageRecord[],
      };
  if (input.checkpointKey) {
    const checkpoint = session.state.checkpoints?.[input.checkpointKey] ??
      (input.expectedTool === "commit_goal_identity" && Object.keys(session.state.checkpoints ?? {}).length === 0
        ? await findAcceptedGoalAuthoringIdentity(session.threadId)
        : undefined);
    const cached = checkpoint && resultSchema.safeParse(checkpoint.result);
    if (checkpoint && cached?.success) {
      await saveGoalAuthoringState(session.threadId, {
        ...session.state,
        checkpoints: { ...session.state.checkpoints, [input.checkpointKey]: checkpoint },
        ...(input.markBlueprint ? { blueprintMessageId: checkpoint.messageId } : {}),
      });
      return cached.data;
    }
  }
  const transcript = input.branchId
    ? session.messages
    : await loadGoalAuthoringMessages(session.threadId);
  const bootstrap =
    transcript.length === 0
      ? splitUnitAuthoringBootstrapPrompt(prompt)
      : { userPrompt: prompt };
  const leading: LlmMessageRecord[] = bootstrap.systemPrompt
    ? [{ role: "system", content: bootstrap.systemPrompt }]
    : [];
  for (const message of leading) {
    await appendGoalAuthoringMessage({
      threadId: session.threadId,
      message,
      branchKind: "main",
    });
  }
  const round = await runWithLlmTraceAsync(
    { traceId: session.state.traceId },
    () =>
      runUnitAuthoringAgentRound({
        transcript: [...leading, ...transcript],
        prompt: bootstrap.userPrompt,
        expectedTool: input.expectedTool,
        resultSchema,
        toolCatalog: goalAuthoringToolCatalog,
        authoringKind: "goal",
        operation: input.operation,
        maxRepairAttempts: input.maxRepairAttempts,
        repairInstruction: input.repairInstruction,
        signal: input.signal,
        meta: {
          ...input.meta,
          goalAuthoringTraceId: session.state.traceId,
          goalAuthoringHistoryReuse: transcript.length > 0,
          branchId: input.branchId,
        },
        onToken: input.onToken,
        onPartialCandidate: input.onPartialCandidate,
      }),
  );
  const lastMessageId = await persistRound(
    session.threadId,
    input.branchId ? "module" : "main",
    round,
  );
  if (!input.branchId && (input.markBlueprint || input.checkpointKey || input.expectedTool === "commit_goal_journey")) {
    await saveGoalAuthoringState(session.threadId, {
      ...session.state,
      ...(input.markBlueprint || input.expectedTool === "commit_goal_journey"
        ? { blueprintMessageId: lastMessageId }
        : {}),
      checkpoints: {
        ...session.state.checkpoints,
        ...(input.checkpointKey && lastMessageId
          ? { [input.checkpointKey]: { messageId: lastMessageId, result: round.result } }
          : {}),
      },
    });
  }
  return round.result;
}
