const TRANSIENT_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2034",
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /\b408\b/iu,
  /\b429\b/iu,
  /\b50[0234]\b/iu,
  /already in progress/iu,
  /connection (?:closed|lost|refused|reset|timed out)/iu,
  /fetch failed/iu,
  /network (?:error|failure)/iu,
  /rate.?limit/iu,
  /reservation became stale/iu,
  /service unavailable/iu,
  /socket hang up/iu,
  /temporar(?:y|ily)/iu,
  /timed? ?out/iu,
  /too many requests/iu,
];

// A logical structured generation already performs bounded provider transports
// and positional repair. Background retries cover the remaining stochastic
// model/provider failures without requiring the learner to press Retry.
export const COGNITIVE_MODEL_OUTBOX_MAX_ATTEMPTS = 4;
export const COGNITIVE_MODEL_OUTBOX_RETRY_DELAY_MS = 5_000;
export const COGNITIVE_MODEL_OUTBOX_MAX_RETRY_DELAY_MS = 60_000;
export const COGNITIVE_MODEL_OUTBOX_ERROR_MAX_LENGTH = 2_000;

type ErrorWithMetadata = Error & {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  retryable?: unknown;
  transient?: unknown;
};

export function cognitiveModelOutboxErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, COGNITIVE_MODEL_OUTBOX_ERROR_MAX_LENGTH);
}

/**
 * Fail closed: validation, parsing, and invariant failures are deterministic
 * unless the error carries explicit retry metadata or a known transport signal.
 */
export function isTransientCognitiveModelOutboxError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ErrorWithMetadata;
  if (candidate.retryable === true || candidate.transient === true) return true;
  if (candidate.retryable === false || candidate.transient === false)
    return false;

  const code =
    typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  if (TRANSIENT_ERROR_CODES.has(code)) return true;

  const status = Number(candidate.statusCode ?? candidate.status);
  if (
    status === 408 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }

  if (candidate.name === "AbortError") return true;
  const message = candidate.message ?? "";
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

export type CognitiveModelOutboxFailureDecision = {
  terminal: boolean;
  attemptCount: number;
  data: {
    attemptCount: number;
    nextAttemptAt: Date | null;
    lastError: string;
    deadLetteredAt: Date | null;
  };
};

export function cognitiveModelOutboxRetryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 8));
  return Math.min(
    COGNITIVE_MODEL_OUTBOX_RETRY_DELAY_MS * 3 ** exponent,
    COGNITIVE_MODEL_OUTBOX_MAX_RETRY_DELAY_MS,
  );
}

export function decideCognitiveModelOutboxFailure(params: {
  error: unknown;
  previousAttemptCount: number;
  now?: Date;
}): CognitiveModelOutboxFailureDecision {
  const now = params.now ?? new Date();
  const attemptCount = params.previousAttemptCount + 1;
  const terminal =
    !isTransientCognitiveModelOutboxError(params.error) ||
    attemptCount >= COGNITIVE_MODEL_OUTBOX_MAX_ATTEMPTS;
  return {
    terminal,
    attemptCount,
    data: {
      attemptCount,
      nextAttemptAt: terminal
        ? null
        : new Date(
            now.getTime() + cognitiveModelOutboxRetryDelayMs(attemptCount),
          ),
      lastError: cognitiveModelOutboxErrorMessage(params.error),
      deadLetteredAt: terminal ? now : null,
    },
  };
}
