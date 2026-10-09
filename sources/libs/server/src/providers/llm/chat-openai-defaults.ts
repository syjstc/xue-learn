/** Floor for every ChatOpenAI HTTP client. Structured contracts use the same 5 minutes. */
export const LLM_REQUEST_TIMEOUT_MS = 300_000;

/**
 * Shared ChatOpenAI streaming flags for OpenAI-compatible vendors.
 *
 * `streaming: true` keeps completions on the SSE path.
 *
 * `streamUsage: true` sends `stream_options.include_usage` so the final
 * usage chunk can populate LLM-log tokens and tok/s. MiniMax must not use
 * this — it coalesces tool-argument / JSON frames until usage is known,
 * which delays JIT course-material block previews.
 */
export const CHAT_OPENAI_STREAMING_DEFAULTS = {
  streaming: true,
  streamUsage: true,
} as const;

export const MINIMAX_CHAT_OPENAI_STREAMING_DEFAULTS = {
  streaming: true,
  streamUsage: false,
} as const;
