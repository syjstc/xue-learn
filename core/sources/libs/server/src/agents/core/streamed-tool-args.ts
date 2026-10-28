import type { z } from "zod";
import type { AgentToolCallRecord } from "./types.js";

export function toolArgsAreEmpty(args: unknown): boolean {
  if (args == null) return true;
  if (typeof args === "string") {
    const trimmed = args.trim();
    return !trimmed || trimmed === "{}";
  }
  if (typeof args !== "object" || Array.isArray(args)) return false;
  return Object.keys(args as object).length === 0;
}

export type StreamedToolArgState = {
  buffer: string;
  toolName?: string;
  toolCallId?: string;
};

export function emptyStreamedToolArgState(): StreamedToolArgState {
  return { buffer: "" };
}

export type StreamedToolArgChunk = {
  tool_call_chunks?: Array<{
    args?: string;
    name?: string;
    id?: string;
  }>;
  invalid_tool_calls?: Array<{ args?: string; name?: string; id?: string }>;
  tool_calls?: Array<{ name?: string; args?: unknown; id?: string }>;
};

function appendCumulativeToolArgText(
  buffer: string,
  incoming: string,
): { buffer: string; delta: string } {
  if (!incoming) return { buffer, delta: "" };
  if (incoming.startsWith(buffer)) {
    return { buffer: incoming, delta: incoming.slice(buffer.length) };
  }
  return { buffer: `${buffer}${incoming}`, delta: incoming };
}

function appendIncoming(
  state: StreamedToolArgState,
  incoming: string,
): boolean {
  const next = appendCumulativeToolArgText(state.buffer, incoming);
  if (!next.delta) return false;
  state.buffer = next.buffer;
  return true;
}

/**
 * DeepSeek (and some OpenAI-compatible gateways) stream complete function
 * arguments on tool_call_chunks / invalid_tool_calls, then assemble a terminal
 * tool_calls entry with `{}`. Collect exactly one representation per chunk.
 */
export function collectStreamedToolArgumentChunk(
  chunk: StreamedToolArgChunk,
  state: StreamedToolArgState,
): boolean {
  let accepted = false;
  for (const toolChunk of chunk.tool_call_chunks ?? []) {
    if (toolChunk.name) state.toolName = toolChunk.name;
    if (toolChunk.id) state.toolCallId = toolChunk.id;
    accepted = appendIncoming(state, toolChunk.args ?? "") || accepted;
  }
  if (!accepted) {
    for (const invalidCall of chunk.invalid_tool_calls ?? []) {
      if (invalidCall.name) state.toolName = invalidCall.name;
      if (typeof invalidCall.id === "string" && invalidCall.id) {
        state.toolCallId = invalidCall.id;
      }
      accepted = appendIncoming(state, invalidCall.args ?? "") || accepted;
    }
  }
  if (!accepted) {
    for (const toolCall of chunk.tool_calls ?? []) {
      if (toolCall.name) state.toolName = toolCall.name;
      if (typeof toolCall.id === "string" && toolCall.id) {
        state.toolCallId = toolCall.id;
      }
      if (typeof toolCall.args !== "string") continue;
      accepted = appendIncoming(state, toolCall.args) || accepted;
    }
  }
  return accepted;
}

export function recoverValidatedStreamedToolArgs<TResult>(
  nativeArgs: Record<string, unknown>,
  argumentBuffer: string,
  schema: z.ZodType<TResult>,
  prepare: (
    args: Record<string, unknown>,
  ) => Record<string, unknown> = (args) => args,
): Record<string, unknown> {
  const candidates: Record<string, unknown>[] = [nativeArgs];
  let streamed: Record<string, unknown> | undefined;
  if (argumentBuffer.trim()) {
    try {
      const parsed = JSON.parse(argumentBuffer) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        streamed = parsed as Record<string, unknown>;
        candidates.push(streamed);
      }
    } catch {
      // The normal validation/repair path owns malformed streamed JSON.
    }
  }

  const accepts = (value: Record<string, unknown>) =>
    schema.safeParse(prepare(value)).success;

  for (const candidate of candidates) {
    if (accepts(candidate)) return candidate;
    const values = Object.values(candidate);
    // Unwrap only an unambiguous single object whose complete value independently
    // satisfies the authoritative schema (durable transcripts can wrap an earlier
    // commit, e.g. commit_goal_contract's {contract:{...}}).
    if (values.length !== 1) continue;
    const nested = values[0];
    if (
      nested &&
      typeof nested === "object" &&
      !Array.isArray(nested) &&
      accepts(nested as Record<string, unknown>)
    ) {
      return nested as Record<string, unknown>;
    }
  }
  // DeepSeek often assembles tool_calls as {}. Keep the streamed object so
  // later normalize/Zod repair can name the real issue instead of "all missing".
  if (toolArgsAreEmpty(nativeArgs) && streamed && !toolArgsAreEmpty(streamed)) {
    return streamed;
  }
  return nativeArgs;
}

export function recoverAgentToolCallsFromStream(
  calls: AgentToolCallRecord[],
  state: StreamedToolArgState,
  schemaFor: (name: string) => z.ZodType | undefined,
  prepare?: (
    name: string,
    args: Record<string, unknown>,
  ) => Record<string, unknown>,
): { calls: AgentToolCallRecord[]; recovered: boolean } {
  const prepareArgs = (name: string, args: Record<string, unknown>) =>
    prepare ? prepare(name, args) : args;
  if (
    calls.length === 0 &&
    state.buffer.trim() &&
    state.toolName &&
    schemaFor(state.toolName)
  ) {
    const schema = schemaFor(state.toolName)!;
    const healed = recoverValidatedStreamedToolArgs(
      {},
      state.buffer,
      schema,
      (args) => prepareArgs(state.toolName!, args),
    );
    if (!toolArgsAreEmpty(healed)) {
      return {
        recovered: true,
        calls: [
          {
            id: state.toolCallId || `streamed-tool-${Date.now()}`,
            name: state.toolName,
            args: healed,
          },
        ],
      };
    }
  }

  let recovered = false;
  const next = calls.map((call) => {
    const schema = schemaFor(call.name);
    if (!schema) return call;
    const buffer =
      state.toolName && state.toolName !== call.name ? "" : state.buffer;
    const healed = recoverValidatedStreamedToolArgs(
      call.args,
      buffer,
      schema,
      (args) => prepareArgs(call.name, args),
    );
    if (healed === call.args) return call;
    recovered = true;
    return { ...call, args: healed };
  });
  return { calls: next, recovered };
}

export function emptyToolArgumentsRepairMessage(toolName: string): string {
  return `${toolName} was called with empty arguments {}. The assistant message is not executed. Call ${toolName} again with the complete JSON object in the tool arguments.`;
}
