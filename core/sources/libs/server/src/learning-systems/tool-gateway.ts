import type { z } from "zod";
import type {
  BoundToolSubject,
  ContextEnvelope,
  LearningSystemSubject,
  SubjectScope,
} from "./types.js";
import type { ResolvedCapabilityQueryTool } from "./query-tools.js";

const SCOPE_FIELDS = {
  user: "userId",
  goal: "goalId",
  module: "moduleId",
  unit: "unitId",
  thread: "threadId",
} as const satisfies Record<SubjectScope, keyof LearningSystemSubject>;

const IDENTITY_FIELDS = new Set<keyof LearningSystemSubject>(
  Object.values(SCOPE_FIELDS),
);

const SENSITIVE_RESULT_FIELD = /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|cookie|password|passwd|secret|client[-_]?secret|private[-_]?key|connection[-_]?string)$/i;
const SECRET_TEXT_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
] as const;
const REDACTED = "[REDACTED]";

export type ToolGatewayErrorCode =
  | "aborted"
  | "budget_exhausted"
  | "call_limit"
  | "identity_override"
  | "input_invalid"
  | "result_invalid"
  | "result_too_large"
  | "scope_missing"
  | "scope_mismatch"
  | "tool_not_allowed";

export class ToolGatewayError extends Error {
  constructor(
    readonly code: ToolGatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolGatewayError";
  }
}

export type ToolGatewayTokenEstimator = (value: unknown) => number;

export type ToolGatewayOptions = {
  tools: readonly ResolvedCapabilityQueryTool[];
  subject: BoundToolSubject;
  maxLazyContextTokens: number;
  estimateTokens?: ToolGatewayTokenEstimator;
};

export type ExecuteCapabilityQueryInput = {
  key: string;
  input: unknown;
  signal?: AbortSignal;
};

export type ToolGatewayUsage = {
  callsByTool: Readonly<Record<string, number>>;
  consumedTokens: number;
  reservedTokens: number;
  maxLazyContextTokens: number;
};

export function estimateLazyToolTokens(value: unknown): number {
  const serialized = JSON.stringify(value);
  return Math.max(1, Math.ceil((serialized?.length ?? 0) / 4));
}

/**
 * Executes only resolved read-only query tools. It has no command-router
 * dependency by design, so an LLM-selected query cannot cross the write plane.
 */
export class CapabilityQueryToolGateway {
  private readonly toolsByKey = new Map<string, ResolvedCapabilityQueryTool>();
  private readonly callsByTool = new Map<string, number>();
  private readonly estimateTokens: ToolGatewayTokenEstimator;
  private consumedTokens = 0;
  private reservedTokens = 0;

  constructor(private readonly options: ToolGatewayOptions) {
    if (
      !Number.isFinite(options.maxLazyContextTokens) ||
      options.maxLazyContextTokens < 0
    ) {
      throw new ToolGatewayError(
        "budget_exhausted",
        "Lazy context token budget must be a non-negative finite number",
      );
    }

    for (const resolved of options.tools) {
      if (this.toolsByKey.has(resolved.tool.key)) {
        throw new ToolGatewayError(
          "tool_not_allowed",
          `Query tool "${resolved.tool.key}" is resolved more than once`,
        );
      }
      this.toolsByKey.set(resolved.tool.key, resolved);
    }
    this.estimateTokens = options.estimateTokens ?? estimateLazyToolTokens;
  }

  getAvailableTools(): readonly ResolvedCapabilityQueryTool[] {
    return [...this.toolsByKey.values()];
  }

  getUsage(): ToolGatewayUsage {
    return {
      callsByTool: Object.fromEntries(this.callsByTool),
      consumedTokens: this.consumedTokens,
      reservedTokens: this.reservedTokens,
      maxLazyContextTokens: this.options.maxLazyContextTokens,
    };
  }

  async execute<TResult = unknown>({
    key,
    input,
    signal,
  }: ExecuteCapabilityQueryInput): Promise<ContextEnvelope<TResult>> {
    throwIfAborted(signal);

    const resolved = this.toolsByKey.get(key);
    if (!resolved) {
      throw new ToolGatewayError(
        "tool_not_allowed",
        `Query tool "${key}" is not allowed for this generation operation`,
      );
    }

    assertRequiredScopes(this.options.subject, resolved.tool.requiredScopes);

    const priorCalls = this.callsByTool.get(key) ?? 0;
    if (priorCalls >= resolved.profile.maxCalls) {
      throw new ToolGatewayError(
        "call_limit",
        `Query tool "${key}" exceeded its ${resolved.profile.maxCalls}-call limit`,
      );
    }

    const availableTokens =
      this.options.maxLazyContextTokens -
      this.consumedTokens -
      this.reservedTokens;
    const resultBudget = Math.min(
      resolved.profile.maxResultTokens,
      resolved.tool.maxResultTokens,
      availableTokens,
    );
    if (resultBudget <= 0) {
      throw new ToolGatewayError(
        "budget_exhausted",
        "The total lazy context token budget is exhausted",
      );
    }

    const sanitizedInput = stripBoundIdentityOverrides(
      input,
      this.options.subject,
    );
    const parsedInput = resolved.tool.inputSchema.safeParse(sanitizedInput);
    if (!parsedInput.success) {
      throw new ToolGatewayError(
        "input_invalid",
        `Invalid input for query tool "${key}": ${parsedInput.error.message}`,
      );
    }

    // Reserve the maximum possible result before awaiting. This keeps parallel
    // calls from collectively crossing the total lazy-context budget.
    this.callsByTool.set(key, priorCalls + 1);
    this.reservedTokens += resultBudget;
    try {
      throwIfAborted(signal);
      const rawEnvelope = await resolved.tool.query(
        this.options.subject,
        parsedInput.data,
        signal,
      );
      throwIfAborted(signal);

      assertEnvelopeMetadata(rawEnvelope, resolved, this.options.subject);

      const parsedResult = resolved.tool.resultSchema.safeParse(
        rawEnvelope.data,
      );
      if (!parsedResult.success) {
        throw new ToolGatewayError(
          "result_invalid",
          `Invalid result from query tool "${key}": ${parsedResult.error.message}`,
        );
      }

      const filteredResult = filterCapabilityQuerySecrets(parsedResult.data);
      const filteredParse = resolved.tool.resultSchema.safeParse(filteredResult);
      if (!filteredParse.success) {
        throw new ToolGatewayError(
          "result_invalid",
          `Secret filtering made the result from query tool "${key}" incompatible with its declared schema`,
        );
      }
      const boundedData = truncateSchemaSafeResult(
        filteredParse.data,
        resultBudget,
        this.estimateTokens,
        resolved.tool.resultSchema,
      );
      const usedTokens = this.estimateTokens(boundedData);
      this.consumedTokens += usedTokens;

      return {
        ownerCapabilityId: rawEnvelope.ownerCapabilityId,
        ownerCapabilityVersion: rawEnvelope.ownerCapabilityVersion,
        schemaVersion: rawEnvelope.schemaVersion,
        authority: rawEnvelope.authority,
        scope: { ...rawEnvelope.scope },
        freshness: { ...rawEnvelope.freshness },
        data: boundedData as TResult,
      };
    } finally {
      this.reservedTokens -= resultBudget;
    }
  }
}

/**
 * Capability results may contain flexible nested source metadata. Filter
 * credential-shaped fields and common credential strings at the gateway even
 * when an owning adapter accidentally includes them. Identity and authority
 * metadata remain outside this function and are validated separately.
 */
export function filterCapabilityQuerySecrets(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const visit = (current: unknown): unknown => {
    if (typeof current === "string") {
      return SECRET_TEXT_PATTERNS.reduce(
        (filtered, pattern) => filtered.replace(pattern, REDACTED),
        current,
      );
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) {
        throw new ToolGatewayError(
          "result_invalid",
          "Query tool result cannot contain circular references",
        );
      }
      seen.add(current);
      return current.map(visit);
    }
    if (!isPlainObject(current)) return current;
    if (seen.has(current)) {
      throw new ToolGatewayError(
        "result_invalid",
        "Query tool result cannot contain circular references",
      );
    }
    seen.add(current);

    return Object.fromEntries(
      Object.entries(current).map(([key, child]) => [
        key,
        SENSITIVE_RESULT_FIELD.test(key) ? REDACTED : visit(child),
      ]),
    );
  };

  return visit(value);
}

function assertRequiredScopes(
  subject: BoundToolSubject,
  requiredScopes: readonly SubjectScope[],
): void {
  for (const scope of requiredScopes) {
    const field = SCOPE_FIELDS[scope];
    if (!subject[field]) {
      throw new ToolGatewayError(
        "scope_missing",
        `Query tool requires server-bound ${field}`,
      );
    }
  }
}

function stripBoundIdentityOverrides(
  input: unknown,
  subject: BoundToolSubject,
): unknown {
  const seen = new WeakSet<object>();

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      if (seen.has(value)) {
        throw new ToolGatewayError(
          "input_invalid",
          "Query tool input cannot contain circular references",
        );
      }
      seen.add(value);
      return value.map(visit);
    }
    if (!isPlainObject(value)) {
      return value;
    }
    if (seen.has(value)) {
      throw new ToolGatewayError(
        "input_invalid",
        "Query tool input cannot contain circular references",
      );
    }
    seen.add(value);

    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (IDENTITY_FIELDS.has(key as keyof LearningSystemSubject)) {
        const bound = subject[key as keyof LearningSystemSubject];
        if (child !== undefined && child !== bound) {
          throw new ToolGatewayError(
            "identity_override",
            `Query tool input cannot override server-bound ${key}`,
          );
        }
        continue;
      }
      sanitized[key] = visit(child);
    }
    return sanitized;
  };

  return visit(input);
}

function assertEnvelopeMetadata(
  envelope: unknown,
  resolved: ResolvedCapabilityQueryTool,
  subject: BoundToolSubject,
): asserts envelope is ContextEnvelope {
  if (
    !isPlainObject(envelope) ||
    !isPlainObject(envelope.scope) ||
    !isPlainObject(envelope.freshness)
  ) {
    throw new ToolGatewayError(
      "result_invalid",
      `Query tool "${resolved.tool.key}" did not return a context envelope`,
    );
  }
  if (
    envelope.ownerCapabilityId !== resolved.tool.ownerCapabilityId ||
    envelope.ownerCapabilityVersion !== resolved.ownerCapabilityVersion ||
    envelope.schemaVersion !== resolved.tool.schemaVersion ||
    envelope.authority !== resolved.tool.authority
  ) {
    throw new ToolGatewayError(
      "result_invalid",
      `Query tool "${resolved.tool.key}" returned mismatched capability metadata`,
    );
  }
  if (
    !envelope.freshness ||
    typeof envelope.freshness.asOf !== "string" ||
    envelope.freshness.asOf.length === 0 ||
    typeof envelope.freshness.stale !== "boolean"
  ) {
    throw new ToolGatewayError(
      "result_invalid",
      `Query tool "${resolved.tool.key}" returned invalid freshness metadata`,
    );
  }

  for (const [field, value] of Object.entries(envelope.scope)) {
    if (!IDENTITY_FIELDS.has(field as keyof LearningSystemSubject)) {
      continue;
    }
    if (
      value !== undefined &&
      value !== subject[field as keyof LearningSystemSubject]
    ) {
      throw new ToolGatewayError(
        "scope_mismatch",
        `Query tool "${resolved.tool.key}" returned data outside server-bound ${field}`,
      );
    }
  }
  for (const scope of resolved.tool.requiredScopes) {
    const field = SCOPE_FIELDS[scope];
    if (envelope.scope[field] !== subject[field]) {
      throw new ToolGatewayError(
        "scope_mismatch",
        `Query tool "${resolved.tool.key}" did not retain required ${field} scope`,
      );
    }
  }
}

function truncateSchemaSafeResult(
  data: unknown,
  maxTokens: number,
  estimateTokens: ToolGatewayTokenEstimator,
  schema: z.ZodType,
): unknown {
  if (estimateTokens(data) <= maxTokens) {
    return data;
  }

  if (typeof data === "string") {
    const characters = Array.from(data);
    for (
      let length = maximumFittingPrefix(
        characters.length,
        (candidateLength) =>
          estimateTokens(characters.slice(0, candidateLength).join("")) <=
          maxTokens,
      );
      length >= 0;
      length -= 1
    ) {
      const candidate = characters.slice(0, length).join("");
      const parsed = schema.safeParse(candidate);
      if (parsed.success && estimateTokens(parsed.data) <= maxTokens) {
        return parsed.data;
      }
    }
  } else if (Array.isArray(data)) {
    for (
      let length = maximumFittingPrefix(
        data.length,
        (candidateLength) =>
          estimateTokens(data.slice(0, candidateLength)) <= maxTokens,
      );
      length >= 0;
      length -= 1
    ) {
      const parsed = schema.safeParse(data.slice(0, length));
      if (parsed.success && estimateTokens(parsed.data) <= maxTokens) {
        return parsed.data;
      }
    }
  } else if (isPlainObject(data)) {
    const candidate = truncateObjectArrayResults(
      data,
      maxTokens,
      estimateTokens,
      schema,
    );
    if (candidate !== undefined) return candidate;
  }

  throw new ToolGatewayError(
    "result_too_large",
    "Query tool result exceeds its token budget and cannot be safely truncated",
  );
}

type ArrayPath = Array<string | number>;

function truncateObjectArrayResults(
  data: Record<string, unknown>,
  maxTokens: number,
  estimateTokens: ToolGatewayTokenEstimator,
  schema: z.ZodType,
): unknown | undefined {
  let current: unknown = data;

  while (estimateTokens(current) > maxTokens) {
    const currentTokens = estimateTokens(current);
    const paths = collectNonEmptyArrayPaths(current);
    let best:
      | { data: unknown; tokens: number; pathKey: string }
      | undefined;

    for (const path of paths) {
      const next = cloneWithoutLastArrayItem(current, path);
      const parsed = schema.safeParse(next);
      if (!parsed.success) continue;
      const tokens = estimateTokens(parsed.data);
      if (tokens >= currentTokens) continue;
      const pathKey = path.join(".");
      if (
        !best ||
        tokens < best.tokens ||
        (tokens === best.tokens && pathKey < best.pathKey)
      ) {
        best = { data: parsed.data, tokens, pathKey };
      }
    }

    if (!best) return undefined;
    current = best.data;
  }

  return current;
}

function collectNonEmptyArrayPaths(
  value: unknown,
  path: ArrayPath = [],
  paths: ArrayPath[] = [],
): ArrayPath[] {
  if (Array.isArray(value)) {
    if (value.length > 0) paths.push(path);
    value.forEach((child, index) =>
      collectNonEmptyArrayPaths(child, [...path, index], paths),
    );
    return paths;
  }
  if (!isPlainObject(value)) return paths;
  for (const [key, child] of Object.entries(value)) {
    collectNonEmptyArrayPaths(child, [...path, key], paths);
  }
  return paths;
}

function cloneWithoutLastArrayItem(value: unknown, path: ArrayPath): unknown {
  if (path.length === 0) {
    return Array.isArray(value) ? value.slice(0, -1) : value;
  }
  const [head, ...tail] = path;
  if (Array.isArray(value) && typeof head === "number") {
    return value.map((child, index) =>
      index === head ? cloneWithoutLastArrayItem(child, tail) : child,
    );
  }
  if (isPlainObject(value) && typeof head === "string") {
    return {
      ...value,
      [head]: cloneWithoutLastArrayItem(value[head], tail),
    };
  }
  return value;
}

function maximumFittingPrefix(
  maximum: number,
  fits: (length: number) => boolean,
): number {
  let low = 0;
  let high = maximum;
  let best = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new ToolGatewayError("aborted", "Query tool execution was aborted");
}
