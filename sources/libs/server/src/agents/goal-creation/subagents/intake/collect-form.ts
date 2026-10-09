import { resolveTeachingIntent } from "../../../../goal-creation/teaching-intent.js";
import {
  appendAgentMessage,
  saveCheckpoint,
  type ThreadCheckpoint,
} from "../../../core/checkpoint.js";
import { setInterrupt } from "../../../core/interrupt.js";
import type { RunSubagentResult } from "../../../core/runtime.js";
import type { AgentRunContext, AgentToolCallRecord } from "../../../core/types.js";
import {
  mergeEmbeddedCheckpoint,
  withEmbeddedCheckpoint,
} from "../../embedded.js";
import {
  compileGoalCreationContract,
  goalCreationContractHash,
  goalCreationContractJson,
  resolveGoalCreationExecutionMode,
} from "../../contract.js";
import { isGoalContentLanguageSetting } from "../../../../llm/content-language.js";
import {
  goalStateForLearner,
  goalStateFromCheckpoint,
  mergeGoalState,
  type CollectFormField,
  type GoalCreationState,
  type GoalSpaceSuggestion,
} from "../../state.js";

function scalarCollectFormValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  const option = value as Record<string, unknown>;
  for (const key of ["value", "code", "id", "label", "text"]) {
    const text = scalarCollectFormValue(option[key]);
    if (text) return text;
  }
  return undefined;
}

export function normalizeCollectFormFieldValue(
  field: "level" | "contentLanguage",
  value: unknown,
): string | undefined {
  const normalized = scalarCollectFormValue(value);
  if (!normalized) return undefined;
  if (field === "level") {
    return normalized === "zero" ||
      normalized === "basic" ||
      normalized === "advanced"
      ? normalized
      : undefined;
  }
  return isGoalContentLanguageSetting(normalized) || normalized === "zh"
    ? normalized
    : undefined;
}

export function needsCollectFormInterrupt(state: GoalCreationState): boolean {
  if (state.currentSubagent !== "intake" || state.goalId) {
    return false;
  }
  if (state.isPlannedGoalActivation) return false;
  if (state.isSmallCourse) return false;
  return !state.collectedFields.includes("isSmallCourse");
}

function inferredCollectFormDefaults(
  state: GoalCreationState,
): Record<string, unknown> {
  return inferFormDefaultsFromState(state);
}

function shouldShowCollectFormField(
  state: GoalCreationState,
  field: CollectFormField,
  inferred: Record<string, unknown>,
): boolean {
  if (state.collectedFields.includes(field)) return false;
  if (field === "level" && inferred.level !== undefined) return false;
  if (
    field === "isSmallCourse" &&
    (inferred.isSmallCourse !== undefined || state.isSmallCourse)
  ) {
    return false;
  }
  return true;
}

export function collectFormFieldsForState(
  state: GoalCreationState,
): CollectFormField[] {
  if (state.isSmallCourse) {
    const fields: CollectFormField[] = ["contentLanguage"];
    if (!state.collectedFields.includes("documents")) {
      fields.push("documents");
    }
    return fields;
  }

  const inferred = inferredCollectFormDefaults(state);
  const fields: CollectFormField[] = [];
  if (shouldShowCollectFormField(state, "level", inferred)) {
    fields.push("level");
  }
  if (shouldShowCollectFormField(state, "isSmallCourse", inferred)) {
    fields.push("isSmallCourse");
  }
  fields.push("contentLanguage");
  if (!state.collectedFields.includes("documents")) {
    fields.push("documents");
  }
  return fields;
}

export function inferFormDefaultsFromState(
  state: GoalCreationState,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const text = [
    ...(state.discoveryAnswers ?? []).map((answer) => {
      const question = state.discoveryQuestions.find(
        (item) => item.id === answer.questionId,
      );
      const answerText = Array.isArray(answer.answer)
        ? answer.answer.join("、")
        : answer.answer;
      return `${question?.text ?? ""} ${answerText}`;
    }),
    state.generationOptions,
  ]
    .filter(Boolean)
    .join("\n");

  if (/零基础|从没|从未|完全零|零基础上手/.test(text)) {
    defaults.level = "zero";
  } else if (/进阶|高级|熟练|有经验/.test(text)) {
    defaults.level = "advanced";
  } else if (/有基础|做过|学过|接触过/.test(text)) {
    defaults.level = "basic";
  }

  if (
    /小课|小型课程|小型|速成|短期|精炼|快速入门|精简路径|只要核心|入门即可/.test(
      text,
    )
  ) {
    defaults.isSmallCourse = true;
  }

  return defaults;
}

export function collectFormDefaultsForState(
  state: GoalCreationState,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const inferred = inferFormDefaultsFromState(state);
  const level =
    normalizeCollectFormFieldValue("level", overrides.level) ??
    normalizeCollectFormFieldValue("level", inferred.level) ??
    normalizeCollectFormFieldValue("level", state.level) ??
    "zero";
  const contentLanguage =
    normalizeCollectFormFieldValue(
      "contentLanguage",
      overrides.contentLanguage,
    ) ??
    normalizeCollectFormFieldValue("contentLanguage", state.contentLanguage) ??
    "auto";
  const isSmallCourse =
    typeof overrides.isSmallCourse === "boolean"
      ? overrides.isSmallCourse
      : inferred.isSmallCourse === true || state.isSmallCourse;
  return {
    ...overrides,
    ...inferred,
    level,
    contentLanguage,
    generationOptions:
      typeof overrides.generationOptions === "string"
        ? overrides.generationOptions
        : state.generationOptions,
    isSmallCourse,
  };
}

function pruneCollectFormFields(
  state: GoalCreationState,
  fields: CollectFormField[],
): CollectFormField[] {
  const inferred = inferredCollectFormDefaults(state);
  return fields.filter((field) => {
    if (field === "contentLanguage") return true;
    if (field === "documents")
      return !state.collectedFields.includes("documents");
    return shouldShowCollectFormField(state, field, inferred);
  });
}

/** Normalize collect_form UI args so mandatory fields always reach the client. */
export function enrichCollectFormUiArgs(
  state: GoalCreationState,
  args: Record<string, unknown> = {},
): Record<string, unknown> {
  const requested = Array.isArray(args.fields)
    ? (args.fields as CollectFormField[])
    : [];
  const merged =
    requested.length > 0
      ? Array.from(
          new Set<CollectFormField>([
            ...requested,
            "contentLanguage",
            "documents",
            ...(!state.isSmallCourse &&
            !state.collectedFields.includes("isSmallCourse")
              ? (["isSmallCourse"] as const)
              : []),
          ]),
        )
      : collectFormFieldsForState(state);
  const fields = pruneCollectFormFields(state, merged);
  const defaults = collectFormDefaultsForState(
    state,
    typeof args.defaults === "object" && args.defaults
      ? (args.defaults as Record<string, unknown>)
      : {},
  );
  const { questions: _questions, ...rest } = args;
  return { ...rest, fields, defaults };
}

export async function interruptForCollectForm(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
): Promise<RunSubagentResult> {
  const state = goalStateFromCheckpoint(checkpoint);
  const uiArgs = enrichCollectFormUiArgs(state);
  const { fields, defaults } = uiArgs as {
    fields: CollectFormField[];
    defaults: Record<string, unknown>;
  };

  const toolCall: AgentToolCallRecord = {
    id: `goal-collect-form-${Date.now()}`,
    name: "collect_form",
    args: { fields, defaults },
  };

  const next = mergeGoalState(checkpoint, {
    currentSubagent: "intake",
    currentPhase: "collecting",
  }) as ThreadCheckpoint;
  const { working, globalMessages } = withEmbeddedCheckpoint(next, embedded);
  const workingWithInterrupt = setInterrupt(
    {
      ...working,
      llmMessages: [
        ...working.llmMessages,
        { role: "assistant", content: "", toolCalls: [toolCall] },
      ],
    },
    {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      uiKind: "form",
      args: uiArgs,
    },
  );
  const merged = mergeEmbeddedCheckpoint(
    next,
    workingWithInterrupt,
    globalMessages,
    embedded,
  );

  await ctx.send({
    type: "tool_ui",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    uiKind: "form",
    args: uiArgs,
  });
  await ctx.send({
    type: "interrupt",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  });
  await saveCheckpoint(ctx.threadId, merged);
  await appendAgentMessage(ctx.threadId, {
    role: "assistant",
    content: "",
    toolCalls: [toolCall],
    uiPayload: { uiKind: "form", args: uiArgs },
  });

  return { checkpoint: merged, completed: false, interrupted: true };
}

export async function interruptForConfirmation(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
): Promise<RunSubagentResult> {
  let state = goalStateFromCheckpoint(checkpoint);
  if (!state.isSmallCourse) {
    const resolved = await resolveTeachingIntent(state, {
      userId: ctx.userId,
      threadId: ctx.threadId,
      signal: ctx.signal,
    });
    checkpoint = mergeGoalState(checkpoint, resolved) as ThreadCheckpoint;
    await saveCheckpoint(ctx.threadId, checkpoint);
    state = goalStateFromCheckpoint(checkpoint);
  }
  let contract: unknown;
  let contractJson = state.contractJson;
  let contractHash = state.contractHash;
  try {
    const compiled = compileGoalCreationContract(state);
    contract = compiled;
    contractJson = goalCreationContractJson(compiled);
    contractHash = goalCreationContractHash(compiled);
  } catch {
    contract = undefined;
  }
  const executionMode = resolveGoalCreationExecutionMode(state);
  const toolCall: AgentToolCallRecord = {
    id: `goal-confirmation-${Date.now()}`,
    name: "show_confirmation",
    args: { summary: "请确认学习目标设置" },
  };
  const uiArgs = {
    ...toolCall.args,
    state: goalStateForLearner({
      ...state,
      executionMode,
      contractJson,
      contractHash,
    }),
    ...(contract ? { contract } : {}),
    executionMode,
  };

  const next = mergeGoalState(checkpoint, {
    currentSubagent: "intake",
    currentPhase: "confirming",
    executionMode,
    contractJson,
    contractHash,
  }) as ThreadCheckpoint;
  const { working, globalMessages } = withEmbeddedCheckpoint(next, embedded);
  const workingWithInterrupt = setInterrupt(
    {
      ...working,
      llmMessages: [
        ...working.llmMessages,
        { role: "assistant", content: "", toolCalls: [toolCall] },
      ],
    },
    {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      uiKind: "confirmation_card",
      args: uiArgs,
    },
  );
  const merged = mergeEmbeddedCheckpoint(
    next,
    workingWithInterrupt,
    globalMessages,
    embedded,
  );

  await ctx.send({ type: "phase", phase: "confirming", subagent: "intake" });
  await ctx.send({
    type: "tool_ui",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    uiKind: "confirmation_card",
    args: uiArgs,
  });
  await ctx.send({
    type: "interrupt",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  });
  await saveCheckpoint(ctx.threadId, merged);
  await appendAgentMessage(ctx.threadId, {
    role: "assistant",
    content: "",
    toolCalls: [toolCall],
    uiPayload: { uiKind: "confirmation_card", args: uiArgs },
  });

  return { checkpoint: merged, completed: false, interrupted: true };
}

export async function interruptForGoalSpaceSuggestion(
  ctx: AgentRunContext,
  checkpoint: ThreadCheckpoint,
  embedded: boolean,
  suggestion: GoalSpaceSuggestion,
): Promise<RunSubagentResult> {
  const state = goalStateFromCheckpoint(checkpoint);
  const toolCall: AgentToolCallRecord = {
    id: `goal-space-suggestion-${Date.now()}`,
    name: "suggest_learning_space",
    args: {
      goalId: state.goalId,
      goalTitle: state.refinedTitle || state.topic,
      name: suggestion.name,
      purpose: suggestion.purpose,
      reason: suggestion.reason,
    },
  };
  const next = mergeGoalState(checkpoint, {
    currentSubagent: "intake",
    currentPhase: "confirming",
  }) as ThreadCheckpoint;
  const { working, globalMessages } = withEmbeddedCheckpoint(next, embedded);
  const interrupted = setInterrupt(
    {
      ...working,
      llmMessages: [
        ...working.llmMessages,
        { role: "assistant", content: "", toolCalls: [toolCall] },
      ],
    },
    {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      uiKind: "goal_space_suggestion",
      args: toolCall.args,
    },
  );
  const merged = mergeEmbeddedCheckpoint(
    next,
    interrupted,
    globalMessages,
    embedded,
  );

  await ctx.send({
    type: "tool_ui",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    uiKind: "goal_space_suggestion",
    args: toolCall.args,
  });
  await ctx.send({
    type: "interrupt",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
  });
  await saveCheckpoint(ctx.threadId, merged);
  await appendAgentMessage(ctx.threadId, {
    role: "assistant",
    content: "",
    toolCalls: [toolCall],
    uiPayload: { uiKind: "goal_space_suggestion", args: toolCall.args },
  });
  return { checkpoint: merged, completed: false, interrupted: true };
}
