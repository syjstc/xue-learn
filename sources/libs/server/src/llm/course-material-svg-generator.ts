import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { parsePartialJson } from "@langchain/core/output_parsers";
import { z } from "zod";
import { progressiveCourseSvgMarkup } from "../../../contracts/src/index.js";
import { fitCourseSvgViewBox } from "../../../domain/src/index.js";
import { extractAgentToolCalls } from "../agents/core/extract-tool-calls.js";
import { projectProviderBindingSchema } from "../providers/llm/provider-binding-schema.js";
import {
  compileOpenAiStrictBindingSchema,
  compileStrictBindingSchema,
} from "../providers/llm/strict-binding-schema.js";
import { prepareGenerationInvocation } from "../generation/kernel.js";
import {
  assertCourseSvgRenderable,
  normalizeGeneratedCourseSvg,
  safeCourseSvgMarkupSchema,
} from "./safe-svg.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";
import { type InteractiveBlock } from "./schemas.js";
import { buildMaterialComponentInvocationPrompt } from "../learning-systems/capabilities/material-components/capability.js";
import { MATERIAL_COMPONENT_VIEW_KEYS } from "../learning-systems/capabilities/material-components/keys.js";
import { SVG_STABLE_INSTRUCTION } from "../learning-systems/capabilities/material-components/capability.js";
import { getChatModel } from "./client.js";
import { getLlmProvider } from "./providers/index.js";
import { qwenRequiresAutoToolChoice } from "../providers/llm/vendors/qwen/options.js";
import { getActiveLlmOperationRoute } from "../providers/llm/index.js";
import { beginLlmRequestLog } from "./logger.js";
import {
  parseMessageForLog,
  serializeChatMessagesForLog,
} from "./parse-log-response.js";
import {
  extractAssistantStreamDelta,
  extractAssistantText,
  parseLlmJson,
  stripThinkingTags,
} from "./sanitize-response.js";
import { extractTokenUsage, usageLogFields } from "./token-usage.js";
import {
  attachCourseSvgIntent,
  courseSvgIntentIssue,
  formatCourseSvgIntent,
  type CourseSvgIntent,
} from "./course-svg-intent.js";

export { progressiveCourseSvgMarkup } from "../../../contracts/src/index.js";
export { normalizeGeneratedCourseSvg } from "./safe-svg.js";
export {
  COURSE_SVG_VISUAL_KINDS,
  STATIC_COURSE_SVG_VISUAL_KINDS,
  courseSvgIntentIssue,
  isAnimatedCourseSvgVisualKind,
  type CourseSvgIntent,
  type CourseSvgVisualKind,
} from "./course-svg-intent.js";

/** Provider binding: one SVG markup string, not a JSON scene graph. */
export const courseSvgGenerationBindingSchema = z.object({
  type: z.literal("svg"),
  title: z.string(),
  caption: z.string(),
  alt: z.string(),
  svg: z.string(),
});

export const courseSvgWireSchema = z.object({
  type: z.literal("svg"),
  title: z.string().trim().min(1).max(120).optional(),
  caption: z.string().trim().min(1).max(500),
  alt: z.string().trim().min(1).max(500),
  svg: z.string().trim().min(1).max(60_000),
});

export const courseSvgBlockSchema = courseSvgGenerationBindingSchema.extend({
  title: z.string().trim().min(1).max(120),
  caption: z.string().trim().min(1).max(500),
  alt: z.string().trim().min(1).max(500),
  svg: safeCourseSvgMarkupSchema,
});

export const courseSvgEditSchema = z.object({
  reviewSummary: z.string().trim().min(1).max(2_000),
  edits: z
    .array(
      z.object({
        oldText: z.string().min(1).max(12_000),
        newText: z.string().max(12_000),
      }),
    )
    .min(1)
    .max(12),
});

export function applyCourseSvgEdits(
  current: CourseSvgBlock,
  input: z.infer<typeof courseSvgEditSchema>,
): CourseSvgBlock {
  const totalReplacementBytes = input.edits.reduce(
    (sum, edit) => sum + Buffer.byteLength(edit.newText, "utf8"),
    0,
  );
  if (totalReplacementBytes > 12_000) {
    throw new Error("SVG edit replacement content exceeds 12,000 bytes");
  }

  let svg = current.svg;
  for (const [index, edit] of input.edits.entries()) {
    const first = svg.indexOf(edit.oldText);
    const second = first < 0 ? -1 : svg.indexOf(edit.oldText, first + 1);
    if (first < 0) {
      throw new Error(`SVG edit ${index + 1} oldText was not found`);
    }
    if (second >= 0) {
      throw new Error(`SVG edit ${index + 1} oldText is not unique`);
    }
    svg = `${svg.slice(0, first)}${edit.newText}${svg.slice(
      first + edit.oldText.length,
    )}`;
  }

  return courseSvgBlockSchema.parse({
    ...current,
    svg: assertCourseSvgRenderable(svg),
  });
}

type CourseSvgBlock = z.infer<typeof courseSvgBlockSchema>;

/** Stable forced tool for generate + visual-audit repair (prefix-cache friendly). */
export const COURSE_SVG_TOOL_NAME = "emit_course_svg";
export const COURSE_SVG_EDIT_TOOL_NAME = "edit_course_svg";
/** Max emit/edit submissions before publishing the last diagram. */
export const COURSE_SVG_MAX_AUDIT_ROUNDS = 3;
/**
 * Default tool_choice for DeepSeek/MiniMax prefix-cache stability.
 * Doubao/OpenAI/Codex resolve to a named force via {@link resolveCourseSvgToolChoice}.
 */
export const COURSE_SVG_TOOL_CHOICE = "required" as const;

export type CourseSvgToolChoice =
  | typeof COURSE_SVG_TOOL_CHOICE
  | "auto"
  | {
      type: "function";
      function: {
        name: typeof COURSE_SVG_TOOL_NAME;
      };
    };

/**
 * First emit uses a named force on Doubao/OpenAI/Codex. Repair rounds keep bare
 * `required` so the model may choose `edit_course_svg` or `emit_course_svg`.
 * Qwen thinking mode rejects both `required` and named function objects.
 */
export function resolveCourseSvgToolChoice(
  providerId?: string,
  options?: { allowEdit?: boolean; model?: string },
): CourseSvgToolChoice {
  if (
    qwenRequiresAutoToolChoice({
      provider: providerId,
      model: options?.model,
    })
  ) {
    return "auto";
  }
  if (options?.allowEdit) return COURSE_SVG_TOOL_CHOICE;
  if (
    providerId === "doubao" ||
    providerId === "openai" ||
    providerId === "codex"
  ) {
    return {
      type: "function",
      function: { name: COURSE_SVG_TOOL_NAME },
    };
  }
  return COURSE_SVG_TOOL_CHOICE;
}

/**
 * Doubao/OpenAI `function.strict` requires an OpenAI constrained-decoding
 * subset (`additionalProperties: false`, every property required). Sending the
 * raw projected schema with `strict: true` often yields content JSON instead of
 * a tool call — then the SVG round fails with "must call exactly one …".
 */
export function courseSvgToolParameters(
  providerId?: string,
): Record<string, unknown> {
  const projected = projectProviderBindingSchema(
    courseSvgGenerationBindingSchema,
  );
  if (
    providerId === "doubao" ||
    providerId === "openai" ||
    providerId === "custom"
  ) {
    return (
      compileOpenAiStrictBindingSchema(courseSvgGenerationBindingSchema) ??
      projected
    );
  }
  if (providerId === "deepseek") {
    return (
      compileStrictBindingSchema(
        courseSvgGenerationBindingSchema,
        "deepseek",
      ) ?? projected
    );
  }
  return projected;
}

export function buildCourseSvgToolDefinitions(options?: {
  providerId?: string;
  allowEdit?: boolean;
}) {
  const tools = [
    {
      type: "function" as const,
      function: {
        name: COURSE_SVG_TOOL_NAME,
        description:
          "Commit one complete teaching SVG diagram with title, caption, alt, and raw svg markup.",
        parameters: courseSvgToolParameters(options?.providerId),
        strict: true,
      },
    },
  ];
  // Tool definitions are part of the provider's cached request prefix. Keep
  // the complete catalog byte-identical from the first emit through every
  // audit repair; runCourseSvgToolRound still rejects edit_course_svg until a
  // current audited block exists.
  tools.push({
    type: "function" as const,
    function: {
      name: COURSE_SVG_EDIT_TOOL_NAME,
      description:
        "Repair the current SVG with the smallest necessary set of exact oldText-to-newText replacements. Preserve every already-correct object and relationship. This tool is valid only after an audit rejects an emitted SVG; prefer it over emitting the complete SVG when the audit can be fixed locally.",
      parameters: {
        type: "object",
        properties: {
          reviewSummary: { type: "string" },
          edits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                oldText: { type: "string" },
                newText: { type: "string" },
              },
              required: ["oldText", "newText"],
              additionalProperties: false,
            },
          },
        },
        required: ["reviewSummary", "edits"],
        additionalProperties: false,
      },
      strict: true,
    },
  } as (typeof tools)[number]);
  return tools;
}

/** Recover when a provider returns the SVG object (or raw markup) in content. */
export function recoverCourseSvgToolCallFromText(
  text: string,
  intent: CourseSvgIntent,
): {
  id: string;
  name: typeof COURSE_SVG_TOOL_NAME;
  args: Record<string, unknown>;
} | null {
  const stripped = stripThinkingTags(text).trim();
  if (!stripped) return null;
  const rawSvg = extractSvgMarkup(stripped);
  let candidate: unknown;
  let parsedAsJson = false;
  try {
    candidate = parseLlmJson<unknown>(stripped);
    parsedAsJson = true;
  } catch {
    candidate = rawSvg || stripped;
  }
  const tryCoerce = (value: unknown) => {
    const coerced = coerceCourseSvgObject(value, intent);
    const parsed = courseSvgBlockSchema.safeParse(coerced);
    return parsed.success ? parsed.data : null;
  };
  let block = tryCoerce(candidate);
  if (!block && parsedAsJson && rawSvg) {
    block = tryCoerce(rawSvg);
  }
  if (!block) return null;
  return {
    id: `course-svg-content-${Date.now()}`,
    name: COURSE_SVG_TOOL_NAME,
    args: block as Record<string, unknown>,
  };
}

/** Append-only visual-audit rejection into the gen-model transcript. */
export function svgVisualAuditRepairContinuation(params: {
  toolCallId: string;
  reason: string;
}): ToolMessage {
  const reason =
    params.reason.trim() ||
    "图片审查发现当前结果尚未达到使用要求，请基于已有结果修正具体问题。";
  return new ToolMessage({
    tool_call_id: params.toolCallId,
    content: `${reason}\n\n请据此对当前 SVG 做最小必要修正。执行前逐项比对“当前状态→目标状态”：只修改两者不同的对象，审查中已符合目标的对象和关系必须原样保留，禁止因“全部反转”、“统一调整”之类概括而改坏正确部分。若涉及箭头，按线路起点→箭头终点核对每一条路径；仅当它的当前起终点与目标不同时才反转或重画。在 reviewSummary 中简要写明“修改什么、保留什么”，并在提交前核对所有验收标准。优先用 ${COURSE_SVG_EDIT_TOOL_NAME} 做少量精确替换；仅在无法局部修复时用 ${COURSE_SVG_TOOL_NAME} 提交完整修正版。`,
  });
}

function extractSvgMarkup(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = normalizeGeneratedCourseSvg(value);
  if (normalized.startsWith("<svg")) return normalized;
  const match = value.match(/<svg\b[\s\S]*<\/svg>/iu);
  return match ? normalizeGeneratedCourseSvg(match[0]) : "";
}

function coerceCourseSvgObject(
  candidate: unknown,
  intent: CourseSvgIntent,
): unknown {
  if (typeof candidate === "string") {
    const svg = extractSvgMarkup(candidate);
    if (!svg) return candidate;
    return {
      type: "svg",
      title: intent.learningGoal.slice(0, 120),
      caption: intent.expectedInsight.slice(0, 500),
      alt: intent.learningGoal.slice(0, 500),
      svg,
    };
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return candidate;
  }
  const source = candidate as Record<string, unknown>;
  const svg =
    extractSvgMarkup(source.svg) ||
    extractSvgMarkup(source.markup) ||
    (typeof source.content === "string"
      ? extractSvgMarkup(source.content)
      : "");
  if (!svg) return candidate;
  const title =
    typeof source.title === "string" && source.title.trim()
      ? source.title.trim().slice(0, 120)
      : intent.learningGoal.slice(0, 120);
  const caption =
    typeof source.caption === "string" && source.caption.trim()
      ? source.caption.trim().slice(0, 500)
      : typeof source.summary === "string" && source.summary.trim()
        ? source.summary.trim().slice(0, 500)
        : intent.expectedInsight.slice(0, 500);
  const alt =
    typeof source.alt === "string" && source.alt.trim()
      ? source.alt.trim().slice(0, 500)
      : intent.learningGoal.slice(0, 500);
  return { type: "svg", title, caption, alt, svg };
}

export function progressiveCourseSvgBlock(
  candidate: unknown,
  intent: CourseSvgIntent,
): InteractiveBlock | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const source = candidate as Record<string, unknown>;
  if (typeof source.svg === "string") {
    const progressiveSvg = progressiveCourseSvgMarkup(source.svg);
    const fittedSvg = progressiveSvg
      ? fitCourseSvgViewBox(progressiveSvg)
      : null;
    const svg = fittedSvg
      ? safeCourseSvgMarkupSchema.safeParse(fittedSvg)
      : null;
    if (!svg?.success) return null;
    return {
      type: "svg",
      ...(typeof source.title === "string" && source.title.trim()
        ? { title: source.title.trim().slice(0, 120) }
        : {}),
      caption:
        typeof source.caption === "string" && source.caption.trim()
          ? source.caption.trim().slice(0, 500)
          : intent.expectedInsight,
      alt:
        typeof source.alt === "string" && source.alt.trim()
          ? source.alt.trim().slice(0, 500)
          : intent.learningGoal,
      svg: svg.data,
      svgSource: source.svg,
    } as InteractiveBlock;
  }
  return null;
}

/** Provider-independent prepared contract shared by hosted and local adapters. */
export function prepareCourseSvgGeneration(params: {
  intent: CourseSvgIntent;
  unitTitle: string;
  language: string;
  context: string;
  revision?: {
    originalSvg: string;
    feedback: string;
  };
}) {
  const operation = "unit.learning_material.svg_generate" as const;
  const invocation = {
    unitTitle: params.unitTitle,
    language: params.language,
    context: params.context,
    intent: params.intent,
    ...(params.revision ? { revision: params.revision } : {}),
  };
  const prompt =
    buildMaterialComponentInvocationPrompt(
      MATERIAL_COMPONENT_VIEW_KEYS.svgInstructionContext,
      invocation,
    ) ?? "";
  return {
    operation,
    invocation,
    prompt,
    standalonePrompt: `${SVG_STABLE_INSTRUCTION}\n\n${prompt}`,
    bindingSchema: courseSvgGenerationBindingSchema,
    resultSchema: courseSvgBlockSchema,
    intentIssue: courseSvgIntentIssue(params.intent),
    parseProviderOutput(content: string) {
      const rawSvg = extractSvgMarkup(content);
      let candidate: unknown;
      let parsedAsJson = false;
      try {
        candidate = parseLlmJson<unknown>(content);
        parsedAsJson = true;
      } catch {
        candidate = rawSvg || content;
      }
      const coerced = coerceCourseSvgObject(candidate, params.intent);
      const parsed = courseSvgBlockSchema.safeParse(coerced);
      if (parsed.success) return parsed.data;

      // Raw SVG often embeds CSS `{...}` blocks. Those can be misread as JSON
      // objects (e.g. `{fill:red}`), so recover from the original markup.
      if (parsedAsJson && rawSvg) {
        return courseSvgBlockSchema.parse(
          coerceCourseSvgObject(rawSvg, params.intent),
        );
      }
      throw parsed.error;
    },
  };
}

type CourseSvgGenerateParams = {
  intent: CourseSvgIntent;
  unitTitle: string;
  language: string;
  context: string;
  /** Cold standalone repair (no prior generate turn in this process). */
  revision?: {
    originalSvg: string;
    feedback: string;
  };
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  authoringScope?: {
    userId: string;
    goalId: string;
    unitId: string;
  };
  onPartial?: (block: InteractiveBlock) => void | Promise<void>;
};

type SvgToolRoundState = {
  /** Capability/authoring-compacted seed; expanded once via the generation kernel. */
  seedPrompt: string;
  messages: BaseMessage[];
  lastAssistant?: AIMessage;
  lastToolCallId?: string;
  lastDecision?: "emit" | "edit";
};

function isCourseSvgEditMatchError(error: string | undefined): boolean {
  return Boolean(
    error &&
    /^SVG edit \d+ oldText (?:was not found|is not unique)$/u.test(
      error.trim(),
    ),
  );
}

export function courseSvgRepairRetryDirective(params: {
  validationError: string;
  currentSvg: string;
  forceFullEmit: boolean;
}): string {
  if (params.forceFullEmit) {
    return `The exact SVG patch failed again (${params.validationError}). Do not call ${COURSE_SVG_EDIT_TOOL_NAME} again. Call ${COURSE_SVG_TOOL_NAME} and submit one complete corrected SVG based on the latest current SVG and the visual-audit requirements.`;
  }
  return `The exact SVG patch was rejected (${params.validationError}). Re-read the latest current SVG below and create a fresh patch against this exact version. Copy every oldText verbatim, include enough surrounding markup to make it unique, and preserve all unrelated markup. If a safe exact patch is impractical, call ${COURSE_SVG_TOOL_NAME} instead.\n\n<current_svg>\n${params.currentSvg}\n</current_svg>`;
}

function svgRoundUsageLogFields(
  message: AIMessage | AIMessageChunk | undefined,
  durationMs: number,
): Record<string, unknown> {
  const usage = extractTokenUsage(message);
  return usageLogFields(usage, durationMs);
}

function assistantMessageFromResponse(
  response: AIMessage | AIMessageChunk,
): AIMessage {
  if (response instanceof AIMessage && !(response instanceof AIMessageChunk)) {
    return response;
  }
  return new AIMessage({
    content: response.content,
    tool_calls: response.tool_calls,
    additional_kwargs: response.additional_kwargs,
    response_metadata: response.response_metadata,
    usage_metadata: response.usage_metadata,
  });
}

async function ensureCourseSvgTranscriptMessages(
  state: SvgToolRoundState,
  operation: string,
): Promise<BaseMessage[]> {
  if (state.messages.length > 0) return state.messages;
  const prepared = await prepareGenerationInvocation(
    operation.replace(/\.repair$/u, ""),
    state.seedPrompt,
  );
  state.messages = [new HumanMessage(prepared.prompt)];
  return state.messages;
}

async function compactCourseSvgSeedPrompt(
  params: CourseSvgGenerateParams,
  prompt: string,
): Promise<string> {
  if (!params.authoringScope) return prompt;
  const { resolveUnitAuthoringHistoryPrefix } =
    await import("../unit-authoring/history.js");
  const { compactUnitAuthoringStagePrompt } =
    await import("../unit-authoring/agent-round.js");
  const history = await resolveUnitAuthoringHistoryPrefix({
    ...params.authoringScope,
    requireCommits: ["commit_survey"],
  });
  if (!history.available) return prompt;
  return compactUnitAuthoringStagePrompt(prompt, history.messages);
}

async function runCourseSvgToolRound(params: {
  operation: string;
  invocation: Record<string, unknown>;
  intent: CourseSvgIntent;
  unitTitle: string;
  state: SvgToolRoundState;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  onPartial?: (block: InteractiveBlock) => void | Promise<void>;
  allowEdit?: boolean;
  currentBlock?: CourseSvgBlock;
}): Promise<CourseSvgBlock | null> {
  const allowEdit = Boolean(params.allowEdit && params.currentBlock);
  return runValidatedStructuredGeneration(
    {
      mode: "tool-call",
      operation: params.operation,
      schema: courseSvgBlockSchema,
      // Attempt 2 rebases a rejected exact patch against the latest SVG.
      // Attempt 3 accepts only a complete emit if that rebased patch also
      // misses, mirroring a coding agent's read -> patch -> re-read fallback.
      maxRepairAttempts: 2,
      contextSubject: {},
      contextQuery: params.unitTitle.slice(0, 2_000),
      contextInvocation: params.invocation,
      invoke: async ({ attempt, validationError, signal }) => {
        const messages = await ensureCourseSvgTranscriptMessages(
          params.state,
          params.operation,
        );
        const forceFullEmit =
          allowEdit &&
          attempt >= 2 &&
          params.state.lastDecision === "edit" &&
          isCourseSvgEditMatchError(validationError);
        if (
          attempt > 0 &&
          validationError &&
          params.state.lastAssistant &&
          params.state.lastToolCallId
        ) {
          const retryTool =
            params.state.lastDecision === "edit"
              ? COURSE_SVG_EDIT_TOOL_NAME
              : COURSE_SVG_TOOL_NAME;
          messages.push(
            params.state.lastAssistant,
            new ToolMessage({
              tool_call_id: params.state.lastToolCallId,
              content: JSON.stringify({
                status: "rejected",
                tool: retryTool,
                error: validationError,
              }),
            }),
            new HumanMessage(
              allowEdit &&
                params.currentBlock &&
                params.state.lastDecision === "edit" &&
                isCourseSvgEditMatchError(validationError)
                ? courseSvgRepairRetryDirective({
                    validationError,
                    currentSvg: params.currentBlock.svg,
                    forceFullEmit,
                  })
                : allowEdit
                  ? `Call ${COURSE_SVG_EDIT_TOOL_NAME} or ${COURSE_SVG_TOOL_NAME} again with corrected arguments. ${validationError}`
                  : `Call ${COURSE_SVG_TOOL_NAME} again with corrected arguments. ${validationError}`,
            ),
          );
          params.state.lastAssistant = undefined;
          params.state.lastToolCallId = undefined;
          params.state.lastDecision = undefined;
        }

        const model = await getChatModel();
        if (typeof model.bindTools !== "function") {
          throw new Error("Selected model does not support SVG tool calling");
        }
        const providerId = getLlmProvider().id;
        const toolChoice = resolveCourseSvgToolChoice(providerId, {
          allowEdit: allowEdit && !forceFullEmit,
          model: getActiveLlmOperationRoute()?.model,
        });
        const runnable = model.bindTools(
          buildCourseSvgToolDefinitions({
            providerId,
            allowEdit,
          }),
          {
            tool_choice: toolChoice,
          },
        );
        const started = Date.now();
        const log = await beginLlmRequestLog({
          operation: params.operation,
          kind: "chat",
          request: {
            messages: serializeChatMessagesForLog(messages),
            tool: allowEdit
              ? `${COURSE_SVG_EDIT_TOOL_NAME}|${COURSE_SVG_TOOL_NAME}`
              : COURSE_SVG_TOOL_NAME,
            toolChoice,
            providerId,
            transcriptMessageCount: messages.length,
            structuredAttempt: attempt + 1,
            structuredStage: attempt > 0 ? "repair" : "generation",
            outputFormat: "svg_tool_call",
            unitTitle: params.unitTitle,
            intent: params.intent.learningGoal,
            visualKind: params.intent.visualKind,
            ...params.meta,
          },
          setActiveSpan: true,
        });

        let gathered: AIMessageChunk | undefined;
        let argumentBuffer = "";
        let contentBuffer = "";
        let lastPartial = "";
        let streamedToolCallId: string | undefined;
        try {
          const stream = await runnable.stream(messages, { signal });
          for await (const chunk of stream) {
            signal?.throwIfAborted();
            gathered = gathered ? gathered.concat(chunk) : chunk;
            for (const toolChunk of chunk.tool_call_chunks ?? []) {
              if (toolChunk.name && toolChunk.name !== COURSE_SVG_TOOL_NAME) {
                continue;
              }
              if (toolChunk.id) streamedToolCallId = toolChunk.id;
              const incoming = toolChunk.args ?? "";
              if (!incoming) continue;
              const delta = incoming.startsWith(argumentBuffer)
                ? incoming.slice(argumentBuffer.length)
                : incoming;
              argumentBuffer += delta;
              if (!params.onPartial || !delta) continue;
              try {
                const candidate = parsePartialJson(argumentBuffer);
                const fingerprint = JSON.stringify(candidate);
                if (candidate == null || fingerprint === lastPartial) continue;
                lastPartial = fingerprint;
                const partial = progressiveCourseSvgBlock(
                  coerceCourseSvgObject(candidate, params.intent),
                  params.intent,
                );
                if (partial) await params.onPartial(partial);
              } catch {
                // Incomplete tool-argument JSON while streaming.
              }
            }
            // Doubao (and some OpenAI-compatible endpoints) may stream the SVG
            // object in message content instead of tool_call_chunks.
            const contentDelta = extractAssistantStreamDelta(chunk);
            if (contentDelta) {
              contentBuffer += contentDelta;
              if (params.onPartial && !argumentBuffer.trim()) {
                try {
                  const candidate = parsePartialJson(
                    stripThinkingTags(contentBuffer).trim(),
                  );
                  const fingerprint = JSON.stringify(candidate);
                  if (candidate != null && fingerprint !== lastPartial) {
                    lastPartial = fingerprint;
                    const partial = progressiveCourseSvgBlock(
                      coerceCourseSvgObject(candidate, params.intent),
                      params.intent,
                    );
                    if (partial) await params.onPartial(partial);
                  }
                } catch {
                  // Incomplete content JSON while streaming.
                }
              }
            }
          }
          if (!gathered) {
            throw new Error("SVG generator returned no message");
          }
          const assistant = assistantMessageFromResponse(gathered);
          const allowedToolNames =
            allowEdit && !forceFullEmit
              ? [COURSE_SVG_TOOL_NAME, COURSE_SVG_EDIT_TOOL_NAME]
              : [COURSE_SVG_TOOL_NAME];
          let calls = extractAgentToolCalls(assistant, allowedToolNames);
          if (calls.length === 0 && argumentBuffer.trim()) {
            try {
              calls = [
                {
                  id:
                    streamedToolCallId ??
                    `course-svg-${COURSE_SVG_TOOL_NAME}-${Date.now()}`,
                  name: COURSE_SVG_TOOL_NAME,
                  args: JSON.parse(argumentBuffer) as Record<string, unknown>,
                },
              ];
            } catch {
              // Validated gateway retries malformed calls.
            }
          }
          if (calls.length === 0) {
            const recovered = recoverCourseSvgToolCallFromText(
              extractAssistantText(assistant) || contentBuffer,
              params.intent,
            );
            if (recovered) calls = [recovered];
          }
          const nativeCall = calls[0];
          if (calls.length !== 1 || !nativeCall) {
            throw new Error(
              `SVG generator must call exactly one SVG decision tool`,
            );
          }
          if (nativeCall.name === COURSE_SVG_EDIT_TOOL_NAME) {
            if (!allowEdit || !params.currentBlock) {
              throw new Error(
                `${COURSE_SVG_EDIT_TOOL_NAME} is only valid after a failed visual audit of the current SVG`,
              );
            }
            const edit = courseSvgEditSchema.parse(nativeCall.args);
            const editCallId =
              nativeCall.id.trim() ||
              `course-svg-${COURSE_SVG_EDIT_TOOL_NAME}-${Date.now()}`;
            params.state.lastDecision = "edit";
            params.state.lastAssistant = new AIMessage({
              content: extractAssistantText(assistant),
              tool_calls: [
                {
                  id: editCallId,
                  name: COURSE_SVG_EDIT_TOOL_NAME,
                  args: edit,
                  type: "tool_call" as const,
                },
              ],
            });
            params.state.lastToolCallId = editCallId;
            // Record the attempted patch before applying it. If exact matching
            // fails, the next structured attempt can append a real rejected
            // tool result and rebase against the unchanged current SVG.
            const edited = applyCourseSvgEdits(params.currentBlock, edit);
            const durationMs = Date.now() - started;
            await log?.finish({
              status: "success",
              durationMs,
              response: {
                raw: parseMessageForLog(assistant).raw,
                toolCalls: [
                  { id: editCallId, name: nativeCall.name, args: edit },
                ],
                toolCallCount: 1,
                svgDecision: "edit",
                svgEditCount: edit.edits.length,
                svgEditReplacementBytes: edit.edits.reduce(
                  (sum, item) => sum + Buffer.byteLength(item.newText, "utf8"),
                  0,
                ),
                ...svgRoundUsageLogFields(gathered, durationMs),
              },
            });
            return edited;
          }
          if (nativeCall.name !== COURSE_SVG_TOOL_NAME) {
            throw new Error(`Unexpected SVG decision tool ${nativeCall.name}`);
          }
          const toolCallId =
            nativeCall.id.trim() ||
            streamedToolCallId ||
            `course-svg-${COURSE_SVG_TOOL_NAME}-${Date.now()}`;
          const candidate = coerceCourseSvgObject(
            nativeCall.args,
            params.intent,
          );
          params.state.lastAssistant = new AIMessage({
            content: extractAssistantText(assistant),
            tool_calls: [
              {
                id: toolCallId,
                name: COURSE_SVG_TOOL_NAME,
                args:
                  candidate &&
                  typeof candidate === "object" &&
                  !Array.isArray(candidate)
                    ? (candidate as Record<string, unknown>)
                    : nativeCall.args,
                type: "tool_call" as const,
              },
            ],
          });
          params.state.lastToolCallId = toolCallId;
          params.state.lastDecision = "emit";
          const parsed = parseMessageForLog(assistant);
          const durationMs = Date.now() - started;
          await log?.finish({
            status: "success",
            durationMs,
            response: {
              raw: parsed.raw.trim() ? parsed.raw : candidate,
              toolCalls: [
                {
                  id: toolCallId,
                  name: COURSE_SVG_TOOL_NAME,
                  args: candidate,
                },
              ],
              toolCallCount: 1,
              structuredAttempt: attempt + 1,
              svgDecision: "emit",
              ...svgRoundUsageLogFields(gathered, durationMs),
            },
          });
          return candidate;
        } catch (error) {
          const durationMs = Date.now() - started;
          const parsed = gathered ? parseMessageForLog(gathered) : undefined;
          await log?.finish({
            status: "error",
            durationMs,
            ...(parsed
              ? {
                  response: {
                    raw: parsed.raw,
                    toolCallCount: parsed.toolCalls.length,
                    structuredAttempt: attempt + 1,
                    ...svgRoundUsageLogFields(gathered, durationMs),
                  },
                }
              : {}),
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    },
    { signal: params.signal },
  );
}

export async function generateCourseSvg(
  params: CourseSvgGenerateParams,
): Promise<InteractiveBlock | null> {
  const publish = (
    block: CourseSvgBlock | InteractiveBlock | null | undefined,
  ) => attachCourseSvgIntent(block ?? null, params.intent);

  // Cold standalone repair still embeds revision in the prompt — there is no
  // prior generate turn to continue.
  if (params.revision) {
    return publish(await generateCourseSvgOnce(params));
  }

  const prepared = prepareCourseSvgGeneration(params);
  if (prepared.intentIssue) return null;
  const seedPrompt = await compactCourseSvgSeedPrompt(params, prepared.prompt);
  const state: SvgToolRoundState = {
    seedPrompt,
    messages: [],
  };
  const sharedMeta = {
    ...params.meta,
    unitTitle: params.unitTitle,
    intent: params.intent.learningGoal,
    visualKind: params.intent.visualKind,
    outputFormat: "svg_tool_call",
    svgMaxAuditRounds: COURSE_SVG_MAX_AUDIT_ROUNDS,
    ...(params.authoringScope ? { unitAuthoringHistoryReuse: true } : {}),
  };
  const teachingBrief = [
    `Lesson: ${params.unitTitle}`,
    formatCourseSvgIntent(params.intent),
  ].join("\n");
  const invocation = prepared.invocation as Record<string, unknown>;

  let current: CourseSvgBlock | undefined;
  let submissions = 0;

  while (submissions < COURSE_SVG_MAX_AUDIT_ROUNDS) {
    const isRepair = submissions > 0;
    const block = await runCourseSvgToolRound({
      operation: isRepair ? `${prepared.operation}.repair` : prepared.operation,
      invocation,
      intent: params.intent,
      unitTitle: params.unitTitle,
      state,
      signal: params.signal,
      meta: {
        ...sharedMeta,
        svgSubmission: submissions + 1,
        svgStage: isRepair ? "repair" : "author",
      },
      onPartial: params.onPartial,
      allowEdit: isRepair,
      currentBlock: current,
    });
    if (!block) return publish(current);

    current = block;
    submissions += 1;
    await params.onPartial?.(current);

    const { auditCourseSvgIfConfigured } =
      await import("./course-svg-visual-audit.js");
    const audit = await auditCourseSvgIfConfigured({
      svg: current.svg,
      teachingBrief,
      signal: params.signal,
    });
    if (!audit || audit.result) return publish(current);
    if (submissions >= COURSE_SVG_MAX_AUDIT_ROUNDS) return publish(current);

    if (state.lastAssistant && state.lastToolCallId) {
      state.messages.push(state.lastAssistant);
      const continuation = svgVisualAuditRepairContinuation({
        toolCallId: state.lastToolCallId,
        reason:
          audit.reason?.trim() ||
          "图片审查发现当前结果尚未达到使用要求，请基于已有结果修正具体问题。",
      });
      state.messages.push(continuation);
      state.lastAssistant = undefined;
      state.lastToolCallId = undefined;
      state.lastDecision = undefined;
    }
  }

  return publish(current);
}

/** Object-mode path for cold revision prompts (no prior tool transcript). */
async function generateCourseSvgOnce(
  params: CourseSvgGenerateParams,
): Promise<CourseSvgBlock | null> {
  const prepared = prepareCourseSvgGeneration(params);
  if (prepared.intentIssue) return null;
  const operation = prepared.operation;
  const invocation = prepared.invocation;
  const prompt = await compactCourseSvgSeedPrompt(params, prepared.prompt);
  const block = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: courseSvgBlockSchema,
      prompt,
      options: {
        operation,
        bindingSchema: courseSvgGenerationBindingSchema,
        deepseekStrictOnly: true,
        meta: {
          ...params.meta,
          unitTitle: params.unitTitle,
          intent: params.intent.learningGoal,
          visualKind: params.intent.visualKind,
          outputFormat: "svg_markup_object",
          ...(params.authoringScope ? { unitAuthoringHistoryReuse: true } : {}),
        },
      },
      contextSubject: {},
      contextQuery: params.unitTitle.slice(0, 2_000),
      contextInvocation: invocation,
      recoveryPolicy: {
        sourceSchema: courseSvgWireSchema,
        normalize: (candidate) => {
          const value = coerceCourseSvgObject(candidate, params.intent);
          const source =
            value && typeof value === "object" && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : null;
          return {
            value,
            normalizedCount:
              source &&
              typeof candidate === "object" &&
              candidate !== null &&
              !Array.isArray(candidate) &&
              (candidate as Record<string, unknown>).type !== "svg"
                ? 1
                : 0,
          };
        },
        repairSlots: () => [],
      },
    },
    {
      signal: params.signal,
      onPartial: params.onPartial
        ? async (candidate) => {
            const partial = progressiveCourseSvgBlock(candidate, params.intent);
            if (partial) await params.onPartial?.(partial);
          }
        : undefined,
    },
  );
  return block;
}

/** In-lesson diagrams compile to raw SVG markup. HTML playgrounds are lab-only. */
export async function compileTeachingDiagram(
  params: CourseSvgGenerateParams,
): Promise<InteractiveBlock | null> {
  return generateCourseSvg(params);
}
