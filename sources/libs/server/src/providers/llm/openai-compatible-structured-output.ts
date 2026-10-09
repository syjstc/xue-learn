import { parsePartialJson } from "@langchain/core/output_parsers";
import {
  extractAssistantStreamChunk,
  extractAssistantStreamDelta,
  parseCompleteLlmJsonDetailed,
  parseLlmJsonDetailed,
  repairCollapsedStringArraysInJson,
  repairInvalidEscapesInJson,
  repairUnescapedEmbeddedJsonStrings,
  repairUnescapedQuotesInJson,
  stripThinkingTags,
} from "../../llm/sanitize-response.js";
import { resolveNativeStructuredPayload } from "../../llm/structured-native-parse.js";
import { StructuredOutputAttemptError } from "./structured-output-adapter.js";
import type {
  StructuredOutputAdapter,
  StructuredOutputAttempt,
  StructuredOutputAttemptRequest,
  StructuredOutputAttemptResult,
  StructuredOutputCapableModel,
  NativeStructuredOutputModel,
  StructuredOutputStreamCallbacks,
} from "./structured-output-adapter.js";
import type { StructuredOutputMethod } from "./structured-output-method.js";
import {
  compileOpenAiStrictBindingSchema,
  normalizeStrictBindingCandidate,
  type StrictBindingDialect,
} from "./strict-binding-schema.js";
import { StructuredTextLimitGuard } from "../../llm/structured-contract.js";
import {
  extractTokenUsage,
  rememberStreamUsageChunk,
  type TokenUsageMessage,
} from "../../llm/token-usage.js";

export type StructuredOutputMethodSpec =
  | StructuredOutputMethod
  | {
      method: StructuredOutputMethod;
      /** Constrained decoding / strict tool schema when the vendor supports it. */
      strict?: boolean;
    };

function toolStreamUsageFields(
  usageChunk: TokenUsageMessage | undefined,
  lastChunk: unknown,
): Record<string, unknown> {
  const usageSource =
    usageChunk ?? (lastChunk as TokenUsageMessage | undefined);
  const usage = extractTokenUsage(usageSource);
  if (!usage) return {};
  return {
    usage_metadata: usage,
    ...(usageSource?.response_metadata
      ? { response_metadata: usageSource.response_metadata }
      : {}),
  };
}

function resolveMethodSpec(spec: StructuredOutputMethodSpec): {
  method: StructuredOutputMethod;
  strict: boolean;
} {
  return typeof spec === "string"
    ? { method: spec, strict: false }
    : { method: spec.method, strict: Boolean(spec.strict) };
}

type RawStructuredResult = { raw?: unknown; parsed?: unknown };

type ToolStreamChunk = {
  content?: unknown;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
  tool_call_chunks?: Array<{ args?: string; index?: number }>;
  tool_calls?: Array<{ name?: string; args?: unknown }>;
  invalid_tool_calls?: Array<{ args?: string; name?: string }>;
};

type ToolStreamCapableModel = StructuredOutputCapableModel & {
  bindTools?: (
    tools: unknown[],
    kwargs?: unknown,
  ) => {
    stream: (
      input: string,
      options?: { signal?: AbortSignal },
    ) => Promise<AsyncIterable<unknown>>;
  };
};

type StructuredToolChoice =
  | "auto"
  | "none"
  | "required"
  | {
      type: "function";
      function: { name: string };
    };

function isRawStructuredResult(value: unknown): value is RawStructuredResult {
  return typeof value === "object" && value !== null && "parsed" in value;
}

function candidateFrom(value: unknown): unknown {
  if (!isRawStructuredResult(value)) return value;
  // LangChain's includeRaw wrapper can carry a perfectly usable AIMessage
  // while leaving `parsed` null when its native parser does not recognize a
  // provider's tool-call/json envelope. Do not discard that raw payload: the
  // shared resolver can recover tool arguments or visible JSON for validation
  // and for positional repair envelopes.
  if (value.parsed != null && !isEmptyStructuredObject(value.parsed)) {
    return value.parsed;
  }
  const recovered = resolveNativeStructuredPayload(
    isEmptyStructuredObject(value.parsed)
      ? { ...value, parsed: null }
      : value,
  ).candidate;
  // Preserve an actual empty object when the raw message has nothing better;
  // the authoritative schema then reports the useful missing-field error.
  return recovered ?? value.parsed;
}

function isEmptyStructuredObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function assertCandidateWithinLimits(
  candidate: unknown,
  request: StructuredOutputAttemptRequest,
): void {
  if (!request.limits) return;
  const guard = new StructuredTextLimitGuard(
    request.limits,
    request.contract?.mode ?? "object",
  );
  guard.push(JSON.stringify(candidate));
  guard.finish();
}

function skipJsonValue(text: string, start: number): number | undefined {
  const first = text[start];
  if (!first) return undefined;
  if (first === '"') return jsonStringEnd(text, start);
  if (first !== "{" && first !== "[") {
    const match = text
      .slice(start)
      .match(/^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    return match ? start + match[0].length : undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
}

function jsonStringEnd(text: string, start: number): number | undefined {
  if (text[start] !== '"') return undefined;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return index + 1;
  }
  return undefined;
}

function skipJsonWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  return index;
}

function completeJsonArrayValues(
  text: string,
  key: string,
): unknown[] | undefined {
  const needle = `"${key}"`;
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const keyIndex = text.indexOf(needle, searchFrom);
    if (keyIndex < 0) return undefined;
    let cursor = skipJsonWhitespace(text, keyIndex + needle.length);
    if (text[cursor] !== ":") {
      searchFrom = keyIndex + needle.length;
      continue;
    }
    cursor = skipJsonWhitespace(text, cursor + 1);
    if (text[cursor] !== "[") {
      searchFrom = keyIndex + needle.length;
      continue;
    }
    const values: unknown[] = [];
    cursor += 1;
    while (cursor < text.length) {
      cursor = skipJsonWhitespace(text, cursor);
      if (cursor >= text.length) return values;
      if (text[cursor] === "]") return values;
      if (text[cursor] === ",") {
        cursor += 1;
        continue;
      }
      const end = skipJsonValue(text, cursor);
      if (end == null) return values;
      try {
        values.push(JSON.parse(text.slice(cursor, end)));
      } catch {
        return values;
      }
      cursor = end;
    }
    return values;
  }
  return undefined;
}

/**
 * Recover complete array items from a truncated structured buffer when
 * parsePartialJson rejects the trailing incomplete value (common while a
 * later `items[]` object is still streaming, and for legacy escaped
 * `items[].json` strings that contain raw quotes).
 */
function trimIncompleteMaterialJsonItems(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return candidate;
  }
  const record = candidate as Record<string, unknown>;
  const trimArray = (values: unknown[]): unknown[] => {
    const trimmed: unknown[] = [];
    for (const value of values) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof (value as { json?: unknown }).json === "string"
      ) {
        try {
          JSON.parse((value as { json: string }).json);
        } catch {
          break;
        }
      }
      trimmed.push(value);
    }
    return trimmed;
  };
  if (Array.isArray(record.items)) {
    return { ...record, items: trimArray(record.items) };
  }
  if (Array.isArray(record.blocks)) {
    return { ...record, blocks: trimArray(record.blocks) };
  }
  return candidate;
}

function harvestGrowingArrayCandidate(rawArguments: string): unknown {
  const items = completeJsonArrayValues(rawArguments, "items");
  if (items && items.length > 0) {
    const completeItems = trimIncompleteMaterialJsonItems({ items }) as {
      items: unknown[];
    };
    if (completeItems.items.length > 0) return completeItems;
  }
  const blocks = completeJsonArrayValues(rawArguments, "blocks");
  if (!blocks || blocks.length === 0) return undefined;
  return { blocks };
}

function incrementalToolCandidate(rawArguments: string): unknown {
  let bestCandidate: unknown;
  let bestSize = -1;
  const consider = (candidate: unknown) => {
    if (candidate == null) return;
    try {
      const size = JSON.stringify(candidate).length;
      if (size > bestSize) {
        bestCandidate = candidate;
        bestSize = size;
      }
    } catch {
      // Ignore candidates that cannot be serialized.
    }
  };
  const considerText = (text: string) => {
    try {
      consider(trimIncompleteMaterialJsonItems(parsePartialJson(text)));
    } catch {
      // A later chunk or the repaired variant may become parseable.
    }
    consider(harvestGrowingArrayCandidate(text));
  };

  considerText(rawArguments);
  const repairedArguments = repairInvalidEscapesInJson(
    repairUnescapedQuotesInJson(
      repairUnescapedEmbeddedJsonStrings(rawArguments),
    ),
  );
  if (repairedArguments !== rawArguments) considerText(repairedArguments);
  return bestCandidate;
}

function jsonPayloadFromVisibleText(text: string): string {
  const start = text.search(/[{[]/);
  return start < 0 ? "" : text.slice(start);
}

/** MiniMax (and some gateways) replay the full buffer; others send true deltas. */
function appendCumulativeText(
  buffer: string,
  incoming: string,
): { buffer: string; delta: string } {
  if (!incoming) return { buffer, delta: "" };
  if (incoming.startsWith(buffer)) {
    return { buffer: incoming, delta: incoming.slice(buffer.length) };
  }
  return { buffer: `${buffer}${incoming}`, delta: incoming };
}

/**
 * Stream function-call arguments as incremental JSON text.
 *
 * OpenAI-compatible providers (DeepSeek, DashScope/Qwen, …) emit tool name
 * first, then argument deltas across chunks. Aggregate those deltas, emit
 * provisional parsePartialJson candidates for JIT previews, and treat the
 * completed argument buffer as authoritative for the attempt.
 *
 * @see https://docs.qwencloud.com/developer-guides/text-generation/function-calling
 */
export async function executeOpenAiCompatibleToolStream(
  model: StructuredOutputCapableModel,
  request: StructuredOutputAttemptRequest,
  callbacks: StructuredOutputStreamCallbacks,
  options?: {
    toolChoice?: StructuredToolChoice;
    toolDescription?: string;
  },
): Promise<StructuredOutputAttemptResult> {
  const toolModel = model as ToolStreamCapableModel;
  if (!toolModel.bindTools) {
    return executeOpenAiCompatibleStructuredAttempt(model, request, callbacks, {
      preferToolStream: false,
    });
  }
  const functionDefinition = {
    type: "function" as const,
    function: {
      name: "structured_response",
      description:
        options?.toolDescription ?? "Return the requested structured response.",
      parameters: request.bindingSchema,
      ...(request.attempt.strict ? { strict: true } : {}),
    },
  };
  const toolChoice =
    options?.toolChoice ??
    ({
      type: "function",
      function: { name: "structured_response" },
    } satisfies StructuredToolChoice);
  const runnable = toolModel.bindTools(
    [functionDefinition] as never,
    {
      tool_choice: toolChoice,
      ...(request.attempt.strict ? { strict: true } : {}),
    } as never,
  );
  const stream = await runnable.stream(request.prompt, {
    signal: request.signal,
  });
  let rawArguments = "";
  let contentBuffer = "";
  let lastCandidate: unknown;
  let lastCompleteToolCandidate: unknown;
  let largestIncrementalCandidateSize = -1;
  let lastPartialFingerprint = "";
  let lastChunk: unknown;
  let usageChunk: TokenUsageMessage | undefined;
  let syntaxRepaired = false;
  const guard = request.limits
    ? new StructuredTextLimitGuard(
        request.limits,
        request.contract?.mode ?? "object",
      )
    : undefined;
  const emitPartial = async (candidate: unknown) => {
    const fingerprint = JSON.stringify(candidate) ?? "undefined";
    if (fingerprint === lastPartialFingerprint) return;
    lastPartialFingerprint = fingerprint;
    await callbacks.onPartialCandidate?.(candidate);
  };
  const publishJsonProgress = async (nextJson: string): Promise<void> => {
    if (!nextJson) return;
    const partial = incrementalToolCandidate(nextJson);
    if (partial == null) return;
    lastCandidate = partial;
    largestIncrementalCandidateSize = Math.max(
      largestIncrementalCandidateSize,
      JSON.stringify(partial).length,
    );
    await emitPartial(partial);
  };
  const appendArgumentDelta = async (incoming: string): Promise<boolean> => {
    if (!incoming) return false;
    const appended = appendCumulativeText(rawArguments, incoming);
    if (!appended.delta && appended.buffer === rawArguments) return false;
    if (appended.delta) guard?.push(appended.delta);
    rawArguments = appended.buffer;
    if (appended.delta) {
      await callbacks.onProgress?.("output");
      await callbacks.onToken?.(appended.delta);
    }
    await publishJsonProgress(rawArguments);
    return true;
  };
  for await (const sourceChunk of stream) {
    request.signal?.throwIfAborted();
    lastChunk = sourceChunk;
    usageChunk = rememberStreamUsageChunk(
      usageChunk,
      sourceChunk as TokenUsageMessage,
    );
    const chunk = sourceChunk as ToolStreamChunk;
    if (extractAssistantStreamChunk(chunk).thinking) {
      await callbacks.onProgress?.("reasoning");
    }
    // LangChain often mirrors the same argument delta on tool_call_chunks,
    // invalid_tool_calls (incomplete JSON), and string tool_calls.args.
    // Applying more than one of those per chunk doubles every token after
    // the first: the prefix check only dedupes an exact full replay.
    let acceptedToolArgumentText = false;
    for (const toolChunk of chunk.tool_call_chunks ?? []) {
      if (toolChunk.index != null && toolChunk.index !== 0) continue;
      acceptedToolArgumentText =
        (await appendArgumentDelta(toolChunk.args ?? "")) ||
        acceptedToolArgumentText;
    }
    if (!acceptedToolArgumentText) {
      for (const invalidCall of chunk.invalid_tool_calls ?? []) {
        if (invalidCall.name && invalidCall.name !== "structured_response") {
          continue;
        }
        acceptedToolArgumentText =
          (await appendArgumentDelta(invalidCall.args ?? "")) ||
          acceptedToolArgumentText;
      }
    }
    for (const toolCall of chunk.tool_calls ?? []) {
      if (toolCall.name && toolCall.name !== "structured_response") continue;
      if (toolCall.args == null) continue;
      if (typeof toolCall.args === "string") {
        if (acceptedToolArgumentText) continue;
        // Some LangChain/provider combinations expose the terminal tool
        // arguments as text instead of a parsed object. Feed that text through
        // the same incremental parser as tool_call_chunks so JIT previews and
        // the authoritative final candidate share one path.
        await appendArgumentDelta(toolCall.args);
        continue;
      }
      // A final empty tool-call object is a common metadata chunk. It must not
      // erase a meaningful candidate already recovered from argument deltas.
      if (
        isEmptyStructuredObject(toolCall.args) &&
        lastCandidate != null &&
        !isEmptyStructuredObject(lastCandidate)
      ) {
        continue;
      }
      lastCandidate = toolCall.args;
      lastCompleteToolCandidate = toolCall.args;
      if (JSON.stringify(toolCall.args) !== lastPartialFingerprint &&
          !isEmptyStructuredObject(toolCall.args)) {
        await callbacks.onProgress?.("output");
      }
      await emitPartial(toolCall.args);
    }
    // MiniMax often streams JSON in message content (thinking tagged or split
    // into reasoning_details), and may replay the full buffer each frame.
    // Harvest that text so JIT previews do not wait for a terminal tool call
    // or for several lesson blocks to land in one coalesced arguments chunk.
    const contentIncoming = extractAssistantStreamDelta(chunk);
    if (contentIncoming) {
      const previousJson = jsonPayloadFromVisibleText(
        stripThinkingTags(contentBuffer),
      );
      const appendedContent = appendCumulativeText(
        contentBuffer,
        contentIncoming,
      );
      contentBuffer = appendedContent.buffer;
      if (appendedContent.delta) await callbacks.onProgress?.("output");
      const nextJson = jsonPayloadFromVisibleText(
        stripThinkingTags(contentBuffer),
      );
      if (nextJson && nextJson.length > rawArguments.length) {
        const cursor =
          rawArguments.length >= previousJson.length
            ? rawArguments
            : previousJson;
        const delta = nextJson.startsWith(cursor)
          ? nextJson.slice(cursor.length)
          : "";
        if (delta) {
          guard?.push(delta);
          await callbacks.onToken?.(delta);
        }
        await publishJsonProgress(nextJson);
      }
    }
  }
  if (!rawArguments) {
    rawArguments = jsonPayloadFromVisibleText(stripThinkingTags(contentBuffer));
  } else {
    const contentJson = jsonPayloadFromVisibleText(
      stripThinkingTags(contentBuffer),
    );
    if (contentJson.length > rawArguments.length) {
      rawArguments = contentJson;
    }
  }
  if (rawArguments) {
    guard?.finish();
    // Some OpenAI-compatible providers occasionally restart a completed tool
    // argument object in the same stream. The first object is still complete
    // and schema validation remains authoritative, so use the shared
    // conservative extractor instead of rejecting the whole logical attempt
    // because of trailing repeated JSON.
    try {
      const decoded = parseLlmJsonDetailed(rawArguments);
      lastCandidate = decoded.value;
      syntaxRepaired = decoded.syntaxRepaired;
    } catch (error) {
      // Balanced-root extraction can stop at a stray `}` in one array item and
      // hide valid items that follow it. Retry the exact tool-argument buffer
      // before considering any incremental prefix or model-authored repair.
      try {
        const decoded = parseCompleteLlmJsonDetailed(rawArguments);
        lastCandidate = decoded.value;
        syntaxRepaired = decoded.syntaxRepaired;
      } catch {
        // Continue with schema-guided compatibility repair below.
      }
      const locallyRepaired = repairCollapsedStringArraysInJson(
        rawArguments,
        request.bindingSchema,
      );
      if (!syntaxRepaired && locallyRepaired !== rawArguments) {
        try {
          const decoded = parseCompleteLlmJsonDetailed(locallyRepaired);
          lastCandidate = decoded.value;
          syntaxRepaired = true;
        } catch {
          // Fall through to the existing terminal-candidate/recovery path.
        }
      }
      if (syntaxRepaired) {
        // The schema-guided local rewrite produced a complete JSON value.
      } else {
        // Incremental candidates are previews, not authoritative final output.
        // Promoting the "largest" partial after the complete argument buffer
        // fails to parse can silently discard the rest of a long document. A
        // complete terminal tool call remains usable; otherwise surface the
        // original text so the structured recovery layer can repair its format.
        const terminalSize =
          lastCompleteToolCandidate == null
            ? -1
            : JSON.stringify(lastCompleteToolCandidate).length;
        if (
          lastCompleteToolCandidate != null &&
          terminalSize >= largestIncrementalCandidateSize
        ) {
          lastCandidate = lastCompleteToolCandidate;
        } else {
          throw new StructuredOutputAttemptError(
            error instanceof Error ? error.message : String(error),
            { content: rawArguments },
            { cause: error },
          );
        }
      }
    }
  }
  if (lastCandidate == null) {
    return {
      kind: "unavailable" as const,
      reason: "tool stream returned no arguments",
    };
  }
  // Prefer a loggable raw envelope: stream chunks alone often lack final
  // tool_calls/args, which would otherwise leave LLM error logs as `{}`.
  return {
    kind: "candidate" as const,
    candidate: lastCandidate,
    syntaxRepaired,
    raw: {
      parsed: lastCandidate,
      // Log the original unparsed tool-argument text. The last streamed chunk
      // is often empty or contains only usage metadata.
      raw: {
        content: rawArguments,
        ...toolStreamUsageFields(usageChunk, lastChunk),
      },
    },
  };
}

export async function executeOpenAiCompatibleStructuredAttempt(
  model: StructuredOutputCapableModel,
  request: StructuredOutputAttemptRequest,
  callbacks: StructuredOutputStreamCallbacks,
  options?: {
    preferToolStream?: boolean;
    toolChoice?: StructuredToolChoice;
    toolDescription?: string;
  },
): Promise<StructuredOutputAttemptResult> {
  const preferToolStream = options?.preferToolStream !== false;
  if (
    preferToolStream &&
    request.attempt.method === "functionCalling" &&
    typeof (model as ToolStreamCapableModel).bindTools === "function"
  ) {
    return executeOpenAiCompatibleToolStream(model, request, callbacks, {
      toolChoice: options?.toolChoice,
      toolDescription: options?.toolDescription,
    });
  }

  const nativeModel = model as NativeStructuredOutputModel;
  if (!nativeModel.withStructuredOutput || !request.attempt.method) {
    return { kind: "unavailable", reason: "structured method unavailable" };
  }
  request.signal?.throwIfAborted();
  const runnable = nativeModel.withStructuredOutput(request.bindingSchema, {
    name: "structured_response",
    method: request.attempt.method,
    strict: request.attempt.strict,
    includeRaw: !callbacks.onPartialCandidate,
  });
  if (callbacks.onPartialCandidate && runnable.stream) {
    let last: unknown;
    let lastCandidate: unknown;
    let lastCandidateSize = -1;
    let lastSerialized = "";
    const stream = await runnable.stream(request.prompt, {
      signal: request.signal,
    });
    for await (const chunk of stream) {
      request.signal?.throwIfAborted();
      last = chunk;
      const candidate = candidateFrom(chunk);
      if (candidate == null) continue;
      assertCandidateWithinLimits(candidate, request);
      const serialized = JSON.stringify(candidate);
      // Native structured streams are cumulative. Keep the most complete
      // candidate so a trailing empty/usage object cannot erase a valid one.
      if (serialized.length < lastCandidateSize) continue;
      lastCandidate = candidate;
      lastCandidateSize = serialized.length;
      if (serialized !== lastSerialized) {
        // Native tool streams expose cumulative parsed arguments. They are
        // progress messages, not an authoritative JSON text stream.
        await callbacks.onProgress?.("output");
        await callbacks.onToken?.(serialized);
        lastSerialized = serialized;
      }
      await callbacks.onPartialCandidate(candidate);
    }
    // Terminal provider/usage chunks can be empty even after a complete
    // cumulative candidate was emitted. Keep the last usable candidate rather
    // than reporting the entire native attempt as unavailable.
    const finalCandidate = candidateFrom(last);
    const finalCandidateSize =
      finalCandidate == null ? -1 : JSON.stringify(finalCandidate).length;
    const candidate =
      finalCandidateSize >= lastCandidateSize ? finalCandidate : lastCandidate;
    return candidate == null
      ? { kind: "unavailable", reason: "native stream returned no candidate" }
      : { kind: "candidate", candidate, raw: last };
  }
  const result = await runnable.invoke(request.prompt, {
    signal: request.signal,
  });
  const candidate = candidateFrom(result);
  if (candidate == null) {
    return { kind: "unavailable", reason: "native call returned no candidate" };
  }
  assertCandidateWithinLimits(candidate, request);
  await callbacks.onProgress?.("output");
  await callbacks.onToken?.(JSON.stringify(candidate));
  return { kind: "candidate", candidate, raw: result };
}

export function createOpenAiCompatibleStructuredOutputAdapter(params: {
  getModel: (options?: {
    maxTokens?: number;
    cachePrefix?: string;
  }) => StructuredOutputCapableModel | Promise<StructuredOutputCapableModel>;
  methods: readonly StructuredOutputMethodSpec[];
  /** Override the provider's supported tool-choice encoding. */
  toolChoice?: StructuredToolChoice;
  /** Optional provider-specific guidance for choosing the schema-bearing tool. */
  toolDescription?: string;
  /**
   * Compile the wire schema to this vendor's constrained-decoding subset when
   * an attempt sets `strict`. OpenAI/Doubao use nullable optionals; omit for
   * MiniMax so we only send `function.strict` as a best-effort hint.
   */
  strictBinding?: StrictBindingDialect;
  /** Disable unconstrained prompt-JSON fallback for protocol-specific endpoints. */
  promptJsonFallback?: boolean;
}): StructuredOutputAdapter {
  return {
    createAttemptPlan(request) {
      if (request.mode === "root-array" || request.mode === "json-lines") {
        return [{ id: "raw", transport: "raw" }];
      }
      const maxAttempts = Math.max(
        1,
        request.maxAttempts ?? params.methods.length + 1,
      );
      const canCompileStrict =
        params.strictBinding !== "openai" ||
        request.bindingSchema == null ||
        compileOpenAiStrictBindingSchema(request.bindingSchema) != null;
      const methodSpecs = params.methods.map(resolveMethodSpec);
      const methods = request.preferSchemaConstrained
        ? [...methodSpecs].sort((left, right) => {
            const rank = (spec: { method: StructuredOutputMethod }) =>
              spec.method === "jsonMode" ? 1 : 0;
            return rank(left) - rank(right);
          })
        : methodSpecs;
      const attempts: StructuredOutputAttempt[] = methods
        // When an endpoint explicitly disables prompt-JSON fallback, all
        // available slots remain native attempts (the Codex adapter uses this
        // for bounded function-calling retries).
        .slice(
          0,
          params.promptJsonFallback === false
            ? maxAttempts
            : Math.max(0, maxAttempts - 1),
        )
        .map((spec, index) => ({
          id: `${spec.method}-${index + 1}`,
          transport: "native" as const,
          method: spec.method,
          modelTarget: "default" as const,
          ...(spec.strict &&
          spec.method !== "jsonMode" &&
          canCompileStrict
            ? { strict: true }
            : {}),
        }));
      if (params.promptJsonFallback !== false) {
        attempts.push({ id: "prompt-json", transport: "prompt-json" });
      }
      return attempts.slice(0, maxAttempts);
    },
    async executeAttempt(request, callbacks) {
      if (request.attempt.transport !== "native") {
        return Promise.resolve({
          kind: "unavailable" as const,
          reason: `${request.attempt.transport} is executed by the shared raw streamer`,
        });
      }
      let executionRequest = request;
      if (request.attempt.strict && params.strictBinding === "openai") {
        const compiled = compileOpenAiStrictBindingSchema(request.bindingSchema);
        if (!compiled) {
          return Promise.resolve({
            kind: "unavailable" as const,
            reason: "schema cannot be represented by OpenAI strict mode",
          });
        }
        executionRequest = { ...request, bindingSchema: compiled };
      }
      const normalizeCandidate = (candidate: unknown) =>
        request.attempt.strict && params.strictBinding === "openai"
          ? normalizeStrictBindingCandidate(candidate, request.bindingSchema)
          : candidate;
      return executeOpenAiCompatibleStructuredAttempt(
        await params.getModel({
          maxTokens: request.maxTokens,
          cachePrefix: request.cachePrefix,
        }),
        executionRequest,
        {
          ...callbacks,
          onPartialCandidate: callbacks.onPartialCandidate
            ? (candidate) =>
                callbacks.onPartialCandidate?.(normalizeCandidate(candidate))
            : undefined,
        },
        {
          toolChoice: params.toolChoice,
          toolDescription: params.toolDescription,
        },
      ).then((result) =>
        result.kind === "candidate"
          ? { ...result, candidate: normalizeCandidate(result.candidate) }
          : result,
      );
    },
  };
}
