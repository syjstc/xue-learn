/** Client-safe MiniMax TTS constants and errors (no server/db imports). */

/** MiniMax TTS RPM window — wait this long before retrying error 1002. */
export const MINIMAX_TTS_RATE_LIMIT_RETRY_MS = 30_000;

export class MinimaxTtsApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "MinimaxTtsApiError";
  }

  get isRateLimit(): boolean {
    return this.statusCode === 1002;
  }
}

export function isMinimaxTtsRateLimitError(error: unknown): boolean {
  return error instanceof MinimaxTtsApiError && error.isRateLimit;
}
