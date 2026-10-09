import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { parsePartialJson } from "@langchain/core/output_parsers";
import { z } from "zod";
import { boundedToolCallId } from "../agents/core/tool-call-id.js";
import { compactSurveyPreviewBindingSchema } from "../survey/authoring.js";
import { compactSurveySectionPlanBindingSchema } from "../survey/section-plan.js";
import { componentCategorySelectionBaseSchema } from "../llm/component-dsl-registry.js";
import {
  flashcardJitItemBindingSchema,
  materialGenerationEnvelopeBindingSchema,
  quizJitItemBindingSchema,
} from "../llm/jit-structured-items.js";
import {
  sectionTopicsCommitBindingSchema,
  topicMaterialCommitProviderBindingSchema,
  topicMaterialProviderSchemaForSurface,
} from "../llm/material-topic.js";
import { getChatModel } from "../llm/client.js";
import { beginLlmRequestLog } from "../llm/logger.js";
import { parseMessageForLog } from "../llm/parse-log-response.js";
import { formatStructuredParseError } from "../llm/parse-structured.js";
import {
  buildValidationReport,
  formatValidationReportForModel,
  SECTION_TOPICS_HINTS,
  TOPIC_MATERIAL_HINTS,
} from "../llm/validation-report.js";
import { extractAssistantText } from "../llm/sanitize-response.js";
import {
  extractTokenUsage,
  usageLogFields,
} from "../llm/token-usage.js";
import { projectProviderBindingSchema } from "../providers/llm/provider-binding-schema.js";
import { compileStrictBindingSchema } from "../providers/llm/strict-binding-schema.js";
import { qwenRequiresAutoToolChoice } from "../providers/llm/vendors/qwen/options.js";
import {
  getActiveLlmOperationRoute,
  withLlmOperationRoute,
} from "../providers/llm/index.js";
import { extractAgentToolCalls } from "../agents/core/extract-tool-calls.js";
import { serializeAgentMessagesForLog } from "../agents/core/log-messages.js";
import { recoverValidatedStreamedToolArgs } from "../agents/core/streamed-tool-args.js";
import { repairLlmTranscript } from "../agents/core/transcript.js";
import type {
  AgentToolCallRecord,
  LlmMessageRecord,
} from "../agents/core/types.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import {
  GenerationCancelledError,
  isGenerationCancelled,
} from "../generation/errors.js";

export const UNIT_AUTHORING_OPERATION = "unit.authoring_agent";

/**
 * Some OpenAI-compatible gateways do not reliably reject an in-flight stream
 * when the caller aborts. Keep the authoring request and its log bounded even
 * when the provider's AsyncIterable ignores the signal.
 */
export async function consumeAbortableAuthoringStream<T>(
  streamPromise: Promise<AsyncIterable<T>>,
  signal: AbortSignal | undefined,
  onChunk: (chunk: T) => void | Promise<void>,
): Promise<void> {
  if (!signal) {
    const stream = await streamPromise;
    for await (const chunk of stream) await onChunk(chunk);
    return;
  }

  const abortReason = () => signal.reason ?? new GenerationCancelledError();
  const raceWithAbort = async <TValue>(work: Promise<TValue>) => {
    if (signal.aborted) throw abortReason();
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortReason());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([work, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  };

  const stream = await raceWithAbort(streamPromise);
  const iterator = stream[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await raceWithAbort(iterator.next());
      if (next.done) return;
      signal.throwIfAborted();
      await onChunk(next.value);
    }
  } finally {
    // Do not wait for a provider that is already ignoring cancellation. The
    // race above has already released the request/logging path.
    if (signal.aborted && iterator.return) {
      void Promise.resolve(iterator.return()).catch(() => undefined);
    }
  }
}

const LEARNING_CONTEXT_HEADER =
  "[Learning system context — server supplied; prefix=";
const LEARNING_CONTEXT_FOOTER = "[End learning system context]";

/**
 * Capability-composed policy and durable learner/unit context are instructions,
 * not learner-authored stage input. Keep them in the system role for the whole
 * durable unit-authoring conversation.
 */
export function splitUnitAuthoringBootstrapPrompt(prompt: string): {
  systemPrompt?: string;
  userPrompt: string;
} {
  if (!prompt.startsWith(LEARNING_CONTEXT_HEADER)) {
    return { userPrompt: prompt.trim() };
  }
  const footer = prompt.indexOf(LEARNING_CONTEXT_FOOTER);
  if (footer < 0) return { userPrompt: prompt.trim() };
  const systemEnd = footer + LEARNING_CONTEXT_FOOTER.length;
  return {
    systemPrompt: prompt.slice(0, systemEnd).trim(),
    userPrompt: prompt.slice(systemEnd).trim(),
  };
}

/**
 * A durable authoring transcript already contains prior context and accepted
 * artifacts. Do not pay for or weaken attention with exact lines repeated by
 * stateless legacy prompt builders; append only the new stage delta.
 */
export function compactUnitAuthoringStagePrompt(
  prompt: string,
  transcript: readonly LlmMessageRecord[],
): string {
  if (transcript.length === 0) return prompt.trim();
  const seen = new Set(
    transcript.flatMap((message) =>
      message.content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
  const novelLines = prompt
    .split("\n")
    .filter((line) => !line.trim() || !seen.has(line.trim()));
  const compacted = novelLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return compacted
    ? `Continue from the authoritative context and accepted tool results above.\n\n${compacted}`
    : "Continue the current unit-authoring stage from the authoritative context and accepted tool results above.";
}

export const unitAuthoringCornellCommitBindingSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(["note", "cue", "summary"]),
      text: z.string(),
    }),
  ),
});

export const unitAuthoringKeyPointsCommitBindingSchema = z.object({
  points: z.array(z.string()),
});

export const unitAuthoringFlashcardsCommitBindingSchema = z.object({
  items: z.array(flashcardJitItemBindingSchema),
});

export const unitAuthoringQuizCommitBindingSchema = z.object({
  items: z.array(quizJitItemBindingSchema),
});

export const unitAuthoringToolCatalog = Object.freeze([
  {
    name: "commit_component_selection",
    description:
      "Commit the component-category palette that constrains Survey and lesson authoring.",
    schema: componentCategorySelectionBaseSchema,
  },
  {
    name: "commit_survey",
    description:
      "Commit the complete validated Survey outline and guiding questions.",
    schema: compactSurveyPreviewBindingSchema,
  },
  {
    name: "commit_section_plan",
    description:
      "Commit the complete grouping of the frozen Survey outline into teaching sections.",
    schema: compactSurveySectionPlanBindingSchema,
  },
  {
    name: "commit_section_topics",
    description:
      "Commit the optional introduction and ordered small-topic titles for the current section. Call this before commit_topic_material.",
    schema: sectionTopicsCommitBindingSchema,
  },
  {
    name: "commit_topic_material",
    description:
      "Commit one topic: a single display plus as many lecture-style spoken cues as needed to teach the board clearly (explain every subview and their relationship). Learner-facing copy must stay in the goal content language; do not switch to English because this schema is English. Repair only this topic; do not rewrite earlier accepted topics.",
    schema: topicMaterialCommitProviderBindingSchema,
  },
  {
    name: "commit_section_material",
    description:
      "Commit the current section's complete learning-material envelope with at least 6 content items; the streamed arguments may grow progressively, but the final items array must not be empty or partial.",
    schema: materialGenerationEnvelopeBindingSchema,
  },
  {
    name: "commit_cornell",
    description:
      "Commit Cornell study notes for the unit (note items, cue items, one summary).",
    schema: unitAuthoringCornellCommitBindingSchema,
  },
  {
    name: "commit_key_points",
    description:
      "Commit the unit's course key points: 1 or 2 one-sentence takeaways per content section, concatenated in section order.",
    schema: unitAuthoringKeyPointsCommitBindingSchema,
  },
  {
    name: "commit_flashcards",
    description: "Commit the progressive flashcard deck items for the unit.",
    schema: unitAuthoringFlashcardsCommitBindingSchema,
  },
  {
    name: "commit_quiz",
    description: "Commit the active-recall quiz question items for the unit.",
    schema: unitAuthoringQuizCommitBindingSchema,
  },
] as const);

export type UnitAuthoringToolName =
  (typeof unitAuthoringToolCatalog)[number]["name"];

function assignedToolCallId(call: AgentToolCallRecord, index: number): string {
  return boundedToolCallId(call.id.trim() || `unit-authoring-tool-${index}`);
}

function alignAuthoringToolIds(
  records: readonly LlmMessageRecord[],
): LlmMessageRecord[] {
  let pending: AgentToolCallRecord[] = [];
  let pendingIndex = 0;
  return records.map((record, recordIndex) => {
    if (record.role === "assistant" && record.toolCalls?.length) {
      pending = record.toolCalls.map((call, callIndex) => ({
        ...call,
        id: assignedToolCallId(call, recordIndex * 10 + callIndex),
      }));
      pendingIndex = 0;
      return { ...record, toolCalls: pending };
    }
    if (record.role === "tool") {
      const fallback = pending[pendingIndex]?.id;
      const toolCallId = boundedToolCallId(
        record.toolCallId?.trim() || fallback || "",
      );
      if (toolCallId) pendingIndex += 1;
      return { ...record, toolCallId };
    }
    pending = [];
    pendingIndex = 0;
    return record;
  });
}

function toolNameByCallId(
  records: readonly LlmMessageRecord[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const record of records) {
    if (record.role !== "assistant") continue;
    for (const call of record.toolCalls ?? []) {
      if (call.id) names.set(call.id, call.name);
    }
  }
  return names;
}

export function toUnitAuthoringBaseMessages(
  records: readonly LlmMessageRecord[],
): BaseMessage[] {
  const aligned = repairLlmTranscript(alignAuthoringToolIds(records));
  const names = toolNameByCallId(aligned);
  return aligned.map((message) => {
    if (message.role === "system") return new SystemMessage(message.content);
    if (message.role === "user") return new HumanMessage(message.content);
    if (message.role === "tool") {
      const toolCallId = message.toolCallId ?? "";
      return new ToolMessage({
        content: message.content,
        tool_call_id: toolCallId,
        ...(names.get(toolCallId) ? { name: names.get(toolCallId) } : {}),
      });
    }
    const toolCalls = (message.toolCalls ?? []).filter((call) =>
      call.id.trim(),
    );
    if (toolCalls.length === 0) {
      return message.reasoningContent
        ? new AIMessage({
            content: message.content,
            additional_kwargs: { reasoning_content: message.reasoningContent },
          })
        : new AIMessage(message.content);
    }
    return new AIMessage({
      content: message.content,
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        args: call.args,
        type: "tool_call" as const,
      })),
      additional_kwargs: message.reasoningContent
        ? { reasoning_content: message.reasoningContent }
        : {},
    });
  });
}

function reasoningContent(message: AIMessage): string | undefined {
  const value = message.additional_kwargs?.reasoning_content;
  return typeof value === "string" && value ? value : undefined;
}

export type DurableAuthoringTool = Readonly<{
  name: string;
  description: string;
  schema: z.ZodTypeAny;
}>;

export type UnitAuthoringToolChoice =
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export function resolveUnitAuthoringToolBinding(
  provider: string | undefined,
  expectedTool: string,
  toolCatalog: readonly DurableAuthoringTool[],
  options?: { model?: string },
): {
  toolChoice: UnitAuthoringToolChoice;
  toolCatalog: readonly DurableAuthoringTool[];
} {
  if (
    provider === "bigmodel" ||
    qwenRequiresAutoToolChoice({ provider, model: options?.model })
  ) {
    // BigModel documents only `tool_choice: auto`. Qwen thinking mode 400s on
    // `required` / named function objects. Expose only the current stage's
    // commit tool so auto still selects the required call.
    const stageTool = toolCatalog.filter((tool) => tool.name === expectedTool);
    return {
      toolChoice: "auto",
      toolCatalog: stageTool.length > 0 ? stageTool : toolCatalog,
    };
  }

  if (provider === "codex") {
    // ChatOpenAI Responses drops string `required`. Keep the durable catalog
    // so historical commit_* results stay legal, and name the current tool.
    return {
      toolChoice: {
        type: "function",
        function: { name: expectedTool },
      },
      toolCatalog,
    };
  }

  return {
    toolChoice: UNIT_AUTHORING_TOOL_CHOICE,
    toolCatalog,
  };
}

export { recoverValidatedStreamedToolArgs };

export function langChainTools(
  catalog: readonly DurableAuthoringTool[],
  options: { strict?: boolean } = {},
) {
  return catalog.map((tool) => {
    const projected = projectProviderBindingSchema(toJsonSchema(tool.schema));
    // DeepSeek strict function calling requires every object property's name
    // to appear in `required`, including fields that are optional in the
    // authoritative Zod schema. Compile only schemas that can satisfy that
    // dialect; progressive/opaque contracts such as material items and quiz
    // unions intentionally stay non-strict and are still checked by Zod.
    const strictBinding = options.strict
      ? compileStrictBindingSchema(tool.schema, "deepseek")
      : null;
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: strictBinding ?? projected,
        strict: strictBinding != null,
      },
    };
  });
}

export type UnitAuthoringRoundResult<TResult> = {
  result: TResult;
  /** Failed validation turns kept in linear history (UI may hide `repair`). */
  repairMessages: LlmMessageRecord[];
  userMessage: LlmMessageRecord;
  assistantMessage: LlmMessageRecord;
  toolMessage: LlmMessageRecord;
};

/**
 * Keep tool_choice byte-stable across Survey / section-plan / material stages.
 * DeepSeek (and similar) prefix caches match from the start of the tokenized
 * request; forcing a different function name each stage breaks the shared
 * tools/tool_choice prefix even when the message transcript is identical.
 * Stage prompts still name the expected commit tool; the server validates it.
 */
export const UNIT_AUTHORING_TOOL_CHOICE = "required" as const;

function hintsForAuthoringTool(expectedTool: string) {
  if (expectedTool === "commit_topic_material") return TOPIC_MATERIAL_HINTS;
  if (expectedTool === "commit_section_topics") return SECTION_TOPICS_HINTS;
  return [];
}

export function unitAuthoringValidationRepairPrompt(
  expectedTool: string,
  validationError: string,
): string {
  const materialRequirement =
    expectedTool === "commit_section_material"
      ? " Call commit_section_material only — never commit_component_selection, commit_survey, or commit_section_plan. Every heading needs numeric level 2 or 3. Compare left/right must be objects with label and points arrays. The final items array must contain at least 6 content items (for example, one introduction plus five teaching blocks, or six teaching blocks). Preserve usable items from the rejected call, add the missing teaching content, and do not submit an empty or partial array."
      : expectedTool === "commit_section_topics"
        ? " Call commit_section_topics only with an optional introduction and unique topic ids plus titles. Do not emit teaching displays yet. Keep at most 8 topics."
        : expectedTool === "commit_topic_material"
          ? " Call commit_topic_material only for the requested topicId. Keep one display (atomic or stage) and as many spoken lecture cues as needed to teach it clearly (for multiple subviews: explain each view and their relationship, not only the labels). Give every display, figure, and code region a short unique id. Every cue needs spoken text and targetIds listing one or more of those ids. Keep learner-facing copy in the goal content language; do not mix languages. Do not rewrite already accepted topics."
          : "";
  return `The previous ${expectedTool} arguments failed server validation:\n${validationError}.${materialRequirement}\nCall ${expectedTool} again with the complete corrected arguments only. Keep already-valid fields.`;
}

export function isExpectedAuthoringToolChunk(
  chunkName: string | undefined,
  observedName: string | undefined,
  expectedTool: string,
): boolean {
  const name = chunkName || observedName;
  return !name || name === expectedTool;
}

export async function runUnitAuthoringAgentRound<TResult>(input: {
  transcript: readonly LlmMessageRecord[];
  prompt: string;
  expectedTool: UnitAuthoringToolName | string;
  resultSchema: z.ZodType<TResult>;
  toolCatalog?: readonly DurableAuthoringTool[];
  authoringKind?: "unit" | "goal";
  /** Billing/routing key; defaults to unit.authoring_agent. */
  operation?: string;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  onToken?: (delta: string) => void | Promise<void>;
  onPartialCandidate?: (candidate: unknown) => void | Promise<void>;
}): Promise<UnitAuthoringRoundResult<TResult>> {
  const routingOperation = input.operation?.trim() || UNIT_AUTHORING_OPERATION;
  if (getActiveLlmOperationRoute()?.operationKey !== routingOperation) {
    return withLlmOperationRoute(routingOperation, () =>
      runUnitAuthoringAgentRound(input),
    );
  }
  let acceptedCall: AgentToolCallRecord | undefined;
  let acceptedAssistant: LlmMessageRecord | undefined;
  let acceptedUserMessage: LlmMessageRecord | undefined;
  const repairMessages: LlmMessageRecord[] = [];
  // Linear working transcript so a schema/tool repair reuses the prior
  // user+assistant+tool rejection prefix (cache-friendly) instead of rewriting
  // the stage user message.
  let workingTranscript: LlmMessageRecord[] = [...input.transcript];
  const operation = routingOperation;
  const authoringKind = input.authoringKind ?? "unit";
  const toolCatalog = input.toolCatalog ?? unitAuthoringToolCatalog.map((entry) =>
    entry.name === "commit_topic_material"
      ? { ...entry, schema: topicMaterialProviderSchemaForSurface() }
      : entry,
  );
  const result = await runValidatedStructuredGeneration(
    {
      mode: "tool-call",
      operation,
      schema: input.resultSchema,
      // Material is long and progressively streamed. Give a rejected short
      // commit one additional continuation turn; otherwise a first empty
      // repair can exhaust the round before the model emits the missing items.
      maxRepairAttempts:
        input.expectedTool === "commit_section_material" ||
        input.expectedTool === "commit_topic_material"
          ? 2
          : 1,
      invoke: async ({ attempt, validationError, signal, maxTokens }) => {
        const isRepair = Boolean(validationError);
        const userMessage: LlmMessageRecord = {
          role: "user",
          content: validationError
            ? unitAuthoringValidationRepairPrompt(
                input.expectedTool,
                validationError,
              )
            : input.prompt,
        };
        const requestRecords = [...workingTranscript, userMessage];
        const messages = toUnitAuthoringBaseMessages(requestRecords);
        const route = getActiveLlmOperationRoute();
        const deepseekStrict = route?.provider === "deepseek";
        const model = await getChatModel({
          maxTokens,
          strictStructuredOutput: deepseekStrict,
        });
        if (typeof model.bindTools !== "function") {
          throw new Error(
            `Selected model does not support ${authoringKind} authoring tools`,
          );
        }
        const toolBinding = resolveUnitAuthoringToolBinding(
          route?.provider,
          input.expectedTool,
          toolCatalog,
          { model: route?.model },
        );
        // Keep a fixed catalog for providers that support forced calling.
        // BigModel/Qwen get one stage tool + auto; Codex names the current
        // commit_* so Responses actually forces a function call.
        const runnable = model.bindTools(
          langChainTools(toolBinding.toolCatalog, {
            strict: deepseekStrict,
          }) as never,
          {
            tool_choice: toolBinding.toolChoice,
          } as never,
        );
        const started = Date.now();
        const log = await beginLlmRequestLog({
          operation: isRepair ? `${operation}.repair` : operation,
          kind: "chat",
          request: {
            messages: serializeAgentMessagesForLog(requestRecords),
            [`${authoringKind}AuthoringAgent`]: true,
            expectedTool: input.expectedTool,
            toolChoice: toolBinding.toolChoice,
            toolCatalogSize: toolBinding.toolCatalog.length,
            transcriptMessageCount: workingTranscript.length,
            structuredAttempt: attempt + 1,
            structuredStage: isRepair ? "repair" : "generation",
            ...(input.meta ?? {}),
          },
          setActiveSpan: true,
        });
        let gathered: AIMessageChunk | undefined;
        let argumentBuffer = "";
        let lastPartial = "";
        let streamedToolCallId: string | undefined;
        let streamedToolName: string | undefined;
        const recordRejectedTurn = (
          assistantMessage: LlmMessageRecord,
          rejection: string,
        ) => {
          const toolCallId = assistantMessage.toolCalls?.[0]?.id;
          const rejectedTool: LlmMessageRecord = {
            role: "tool",
            toolCallId: toolCallId ?? `unit-authoring-rejected-${attempt}`,
            content: JSON.stringify({
              status: "rejected",
              tool: input.expectedTool,
              error: rejection,
            }),
          };
          workingTranscript = [
            ...workingTranscript,
            userMessage,
            assistantMessage,
            rejectedTool,
          ];
          repairMessages.push(userMessage, assistantMessage, rejectedTool);
        };
        try {
          await consumeAbortableAuthoringStream(
            runnable.stream(messages, { signal }),
            signal,
            async (chunk) => {
              signal?.throwIfAborted();
              gathered = gathered ? gathered.concat(chunk) : chunk;
              // DeepSeek can expose an in-progress function payload solely
              // through invalid_tool_calls. The terminal AIMessage then
              // carries the expected tool name with `{}` arguments, which
              // used to turn a complete streamed topics array into a bogus
              // "topics: expected array" validation error. Collect exactly
              // one representation per chunk, like the shared structured
              // adapter does, and let the authoritative schema decide whether
              // the recovered JSON is usable.
              let acceptedToolArgumentText = false;
              const appendToolArgumentText = async (incoming: string) => {
                if (!incoming) return false;
                const delta = incoming.startsWith(argumentBuffer)
                  ? incoming.slice(argumentBuffer.length)
                  : incoming;
                if (!delta) return false;
                argumentBuffer += delta;
                await input.onToken?.(delta);
                try {
                  const candidate = parsePartialJson(argumentBuffer);
                  const fingerprint = JSON.stringify(candidate);
                  if (candidate != null && fingerprint !== lastPartial) {
                    lastPartial = fingerprint;
                    await input.onPartialCandidate?.(candidate);
                  }
                } catch {
                  // A trailing incomplete object is expected while tool arguments stream.
                }
                return true;
              };
              for (const toolChunk of chunk.tool_call_chunks ?? []) {
                if (toolChunk.name) {
                  streamedToolName = toolChunk.name;
                  if (streamedToolName !== input.expectedTool) {
                    argumentBuffer = "";
                    continue;
                  }
                }
                if (
                  streamedToolName &&
                  streamedToolName !== input.expectedTool
                ) {
                  continue;
                }
                if (toolChunk.id) streamedToolCallId = toolChunk.id;
                acceptedToolArgumentText =
                  (await appendToolArgumentText(toolChunk.args ?? "")) ||
                  acceptedToolArgumentText;
              }
              if (!acceptedToolArgumentText) {
                for (const invalidCall of chunk.invalid_tool_calls ?? []) {
                  if (
                    invalidCall.name &&
                    invalidCall.name !== input.expectedTool
                  ) {
                    continue;
                  }
                  if (invalidCall.name) streamedToolName = invalidCall.name;
                  const id = (invalidCall as { id?: unknown }).id;
                  if (typeof id === "string" && id) streamedToolCallId = id;
                  acceptedToolArgumentText =
                    (await appendToolArgumentText(invalidCall.args ?? "")) ||
                    acceptedToolArgumentText;
                }
              }
              if (!acceptedToolArgumentText) {
                for (const toolCall of chunk.tool_calls ?? []) {
                  if (
                    toolCall.name &&
                    toolCall.name !== input.expectedTool
                  ) {
                    continue;
                  }
                  if (toolCall.name) streamedToolName = toolCall.name;
                  if (typeof toolCall.args !== "string") continue;
                  await appendToolArgumentText(toolCall.args);
                }
              }
            },
          );
          if (!gathered)
            throw new Error("Unit authoring model returned no message");
          const assistant = gathered as AIMessage;
          const observedCalls = extractAgentToolCalls(
            assistant,
            toolCatalog.map((tool) => tool.name),
          );
          const wrongCall = observedCalls.find(
            (call) => call.name !== input.expectedTool,
          );
          if (
            wrongCall &&
            observedCalls.every((call) => call.name !== input.expectedTool)
          ) {
            const rejection = `${authoringKind} authoring model must call exactly one ${input.expectedTool} (received ${wrongCall.name})`;
            recordRejectedTurn(
              {
                role: "assistant",
                content: extractAssistantText(assistant),
                toolCalls: [
                  {
                    ...wrongCall,
                    id: assignedToolCallId(wrongCall, 0),
                  },
                ],
                ...(reasoningContent(assistant)
                  ? { reasoningContent: reasoningContent(assistant) }
                  : {}),
              },
              rejection,
            );
            throw new Error(`failed server validation: ${rejection}`);
          }
          let calls = extractAgentToolCalls(assistant, [input.expectedTool]);
          // A few OpenAI-compatible streaming endpoints provide valid
          // tool_call_chunks but omit the assembled tool_calls field on the
          // final concatenated message. Recover only from an observed argument
          // stream; plain assistant text is never treated as a commit.
          if (
            calls.length === 0 &&
            argumentBuffer.trim() &&
            isExpectedAuthoringToolChunk(
              undefined,
              streamedToolName,
              input.expectedTool,
            )
          ) {
            try {
              calls = [
                {
                  id:
                    streamedToolCallId ??
                    `unit-authoring-${input.expectedTool}-${Date.now()}`,
                  name: input.expectedTool,
                  args: JSON.parse(argumentBuffer),
                },
              ];
            } catch {
              // The validated gateway will retry malformed/incomplete calls.
            }
          }
          let nativeCall = calls[0];
          if (
            calls.length !== 1 ||
            !nativeCall ||
            nativeCall.name !== input.expectedTool
          ) {
            const rejection = `${authoringKind} authoring model must call exactly one ${input.expectedTool} tool`;
            if (nativeCall) {
              recordRejectedTurn(
                {
                  role: "assistant",
                  content: extractAssistantText(assistant),
                  toolCalls: [
                    {
                      ...nativeCall,
                      id: assignedToolCallId(nativeCall, 0),
                    },
                  ],
                  ...(reasoningContent(assistant)
                    ? { reasoningContent: reasoningContent(assistant) }
                    : {}),
                },
                rejection,
              );
            }
            throw new Error(`failed server validation: ${rejection}`);
          }
          nativeCall = {
            ...nativeCall,
            // Some OpenAI-compatible streaming adapters expose the complete
            // JSON in tool_call_chunks but assemble final tool_calls with {}.
            // Prefer the observed wire arguments only when they satisfy the
            // authoritative stage schema.
            args: recoverValidatedStreamedToolArgs(
              nativeCall.args,
              argumentBuffer,
              input.resultSchema,
            ),
          };
          const parsedArgs = input.resultSchema.safeParse(nativeCall.args);
          if (!parsedArgs.success) {
            const report = buildValidationReport(
              parsedArgs.error,
              nativeCall.args,
              hintsForAuthoringTool(input.expectedTool),
            );
            const rejection = formatValidationReportForModel(report);
            recordRejectedTurn(
              {
                role: "assistant",
                content: extractAssistantText(assistant),
                toolCalls: [
                  {
                    ...nativeCall,
                    id: assignedToolCallId(nativeCall, 0),
                  },
                ],
                ...(reasoningContent(assistant)
                  ? { reasoningContent: reasoningContent(assistant) }
                  : {}),
              },
              rejection,
            );
            throw new Error(`failed server validation: ${rejection}`);
          }
          acceptedCall = {
            ...nativeCall,
            id: assignedToolCallId(nativeCall, 0),
          };
          acceptedAssistant = {
            role: "assistant",
            content: extractAssistantText(assistant),
            toolCalls: [acceptedCall],
            ...(reasoningContent(assistant)
              ? { reasoningContent: reasoningContent(assistant) }
              : {}),
          };
          acceptedUserMessage = userMessage;
          const parsed = parseMessageForLog(assistant);
          const durationMs = Date.now() - started;
          await log?.finish({
            status: "success",
            durationMs,
            response: {
              parsed,
              rawLength: parsed.raw.length,
              toolCallCount: calls.length,
              structuredAttempt: attempt + 1,
              ...usageLogFields(extractTokenUsage(gathered), durationMs),
            },
          });
          // Return provider wire args, not the transformed Zod output.
          // runValidatedStructuredGeneration re-parses this candidate with the
          // same schema; Survey/material preprocessors expect {items:[...]} and
          // mis-read an assembled SurveyPreview as "questions only", which then
          // fails outline-count validation and forces a bogus repair.
          return nativeCall.args;
        } catch (error) {
          const durationMs = Date.now() - started;
          const parsed = gathered ? parseMessageForLog(gathered) : undefined;
          const aborted =
            isGenerationCancelled(error) ||
            (error instanceof DOMException && error.name === "AbortError") ||
            (error instanceof Error && error.name === "AbortError");
          await log?.finish({
            status: "error",
            durationMs,
            ...(parsed || aborted
              ? {
                  response: {
                    ...(parsed
                      ? {
                          parsed,
                          rawLength: parsed.raw.length,
                          structuredAttempt: attempt + 1,
                          ...usageLogFields(
                            extractTokenUsage(gathered),
                            durationMs,
                          ),
                        }
                      : {}),
                    ...(aborted
                      ? {
                          failurePhase: "aborted",
                          structuredValidationStage: isRepair
                            ? "repair"
                            : "generation",
                        }
                      : {}),
                  },
                }
              : {}),
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    },
    { signal: input.signal },
  );
  if (!acceptedCall || !acceptedAssistant || !acceptedUserMessage) {
    throw new Error(
      "Unit authoring round completed without a durable tool call",
    );
  }
  return {
    result,
    repairMessages,
    userMessage: acceptedUserMessage,
    assistantMessage: acceptedAssistant,
    toolMessage: {
      role: "tool",
      toolCallId: acceptedCall.id,
      content: JSON.stringify({ status: "accepted", tool: acceptedCall.name }),
    },
  };
}
