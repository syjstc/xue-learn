import { createHash, randomUUID } from "node:crypto";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import type { z } from "zod";

export type StructuredUnknownKeyMode = "observe" | "enforce" | "normalize";
export type StructuredTimeoutPolicy = "wall-clock" | "idle";

export type StructuredOutputLimits = {
  maximumRawBytes: number;
  maximumJsonDepth: number;
  maximumTopLevelItems: number;
  maximumStringBytes: number;
  timeoutMs: number;
  maxTokens: number;
};

export type StructuredContractMetadata = {
  contractId?: string;
  contractVersion?: number;
  unknownKeyMode?: StructuredUnknownKeyMode;
  /** Output-size budget independent of the provider transport encoding. */
  sizeProfile?: "normal" | "long";
  /** Opt-in streaming inactivity limit; ordinary operations keep a fixed deadline. */
  timeoutPolicy?: StructuredTimeoutPolicy;
  limits?: Partial<StructuredOutputLimits>;
  promptExample?: string;
  transportPolicy?: string;
  recoveryPolicy?: string;
  semanticValidatorId?: string;
};

export type ResolvedStructuredContract = {
  contractId: string;
  contractVersion: number;
  schemaHash: string;
  invocationId: string;
  mode: string;
  unknownKeyMode: StructuredUnknownKeyMode;
  limits: StructuredOutputLimits;
  timeoutPolicy: StructuredTimeoutPolicy;
  promptExampleHash?: string;
  transportPolicy: string;
  recoveryPolicy: string;
  semanticValidatorId?: string;
};

export const STRUCTURED_OUTPUT_TIMEOUT_MS = 300_000;

const NORMAL_LIMITS: StructuredOutputLimits = {
  maximumRawBytes: 1024 * 1024,
  maximumJsonDepth: 40,
  maximumTopLevelItems: 512,
  maximumStringBytes: 256 * 1024,
  timeoutMs: STRUCTURED_OUTPUT_TIMEOUT_MS,
  maxTokens: 16_384,
};

const LONG_JSON_LINES_LIMITS: StructuredOutputLimits = {
  ...NORMAL_LIMITS,
  maximumRawBytes: 4 * 1024 * 1024,
  maxTokens: 65_536,
};

const registry = new Map<string, ResolvedStructuredContract>();

function resolveLowerLimits(
  base: StructuredOutputLimits,
  overrides?: Partial<StructuredOutputLimits>,
): StructuredOutputLimits {
  const lower = (key: keyof StructuredOutputLimits) => {
    const candidate = overrides?.[key];
    return typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > 0
      ? Math.min(base[key], Math.floor(candidate))
      : base[key];
  };
  return {
    maximumRawBytes: lower("maximumRawBytes"),
    maximumJsonDepth: lower("maximumJsonDepth"),
    maximumTopLevelItems: lower("maximumTopLevelItems"),
    maximumStringBytes: lower("maximumStringBytes"),
    timeoutMs: lower("timeoutMs"),
    maxTokens: lower("maxTokens"),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function schemaProjection(
  schema: z.ZodType | Record<string, unknown>,
): unknown {
  if (
    schema &&
    typeof schema === "object" &&
    !("_zod" in schema) &&
    !("_def" in schema)
  ) {
    return schema;
  }
  try {
    return toJsonSchema(schema as z.ZodType);
  } catch {
    return { unrepresentable: true };
  }
}

export function structuredSchemaHash(
  schemas: readonly (z.ZodType | Record<string, unknown>)[],
  policyVersion = 1,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        policyVersion,
        schemas: schemas.map(schemaProjection),
      }),
    )
    .digest("hex");
}

export function structuredCandidateHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function resolveStructuredContract(params: {
  operation: string;
  mode: string;
  schemas: readonly (z.ZodType | Record<string, unknown>)[];
  metadata?: StructuredContractMetadata;
}): ResolvedStructuredContract {
  const contractId = params.metadata?.contractId?.trim() || params.operation;
  const contractVersion = Math.max(
    1,
    Math.floor(params.metadata?.contractVersion ?? 1),
  );
  const baseLimits =
    params.metadata?.sizeProfile === "long" || params.mode === "json-lines"
      ? LONG_JSON_LINES_LIMITS
      : NORMAL_LIMITS;
  const contract: ResolvedStructuredContract = {
    contractId,
    contractVersion,
    schemaHash: structuredSchemaHash(params.schemas, contractVersion),
    invocationId: randomUUID(),
    mode: params.mode,
    unknownKeyMode: params.metadata?.unknownKeyMode ?? "observe",
    limits: resolveLowerLimits(baseLimits, params.metadata?.limits),
    timeoutPolicy: params.metadata?.timeoutPolicy ?? "wall-clock",
    promptExampleHash: params.metadata?.promptExample
      ? createHash("sha256").update(params.metadata.promptExample).digest("hex")
      : undefined,
    transportPolicy: params.metadata?.transportPolicy ?? params.mode,
    recoveryPolicy: params.metadata?.recoveryPolicy ?? "bounded-retry",
    semanticValidatorId: params.metadata?.semanticValidatorId,
  };
  const key = `${contractId}@${contractVersion}:${contract.schemaHash}`;
  registry.set(key, contract);
  return contract;
}

export function listRegisteredStructuredContracts(): ResolvedStructuredContract[] {
  return [...registry.values()];
}

export class StructuredOutputLimitError extends Error {
  constructor(
    readonly code:
      | "RAW_BYTES_EXCEEDED"
      | "JSON_DEPTH_EXCEEDED"
      | "TOP_LEVEL_ITEMS_EXCEEDED"
      | "STRING_BYTES_EXCEEDED"
      | "ATTEMPT_TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "StructuredOutputLimitError";
  }
}

export class StructuredTextLimitGuard {
  private rawBytes = 0;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private stringBytes = 0;
  private root: "array" | "other" | undefined;
  private topLevelItems = 0;
  private lineHasData = false;

  constructor(
    private readonly limits: StructuredOutputLimits,
    private readonly mode: string,
  ) {}

  push(delta: string): void {
    this.rawBytes += Buffer.byteLength(delta);
    if (this.rawBytes > this.limits.maximumRawBytes) {
      throw new StructuredOutputLimitError(
        "RAW_BYTES_EXCEEDED",
        `structured output exceeded ${this.limits.maximumRawBytes} raw bytes`,
      );
    }

    for (const character of delta) {
      if (!/\s/.test(character)) this.lineHasData = true;
      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (character === "\\") {
          this.escaped = true;
        } else if (character === '"') {
          this.inString = false;
          this.stringBytes = 0;
        } else {
          this.stringBytes += Buffer.byteLength(character);
          if (this.stringBytes > this.limits.maximumStringBytes) {
            throw new StructuredOutputLimitError(
              "STRING_BYTES_EXCEEDED",
              `structured output string exceeded ${this.limits.maximumStringBytes} bytes`,
            );
          }
        }
        continue;
      }
      if (this.mode === "json-lines" && character === "\n") {
        if (this.lineHasData && this.depth === 0) this.topLevelItems += 1;
        this.lineHasData = false;
        this.assertTopLevelItems();
        continue;
      }
      if (character === '"') {
        this.inString = true;
        this.stringBytes = 0;
        continue;
      }
      if (character === "{" || character === "[") {
        if (this.depth === 0 && !this.root) {
          this.root = character === "[" ? "array" : "other";
          if (this.root === "array") this.topLevelItems = 1;
        }
        this.depth += 1;
        if (this.depth > this.limits.maximumJsonDepth) {
          throw new StructuredOutputLimitError(
            "JSON_DEPTH_EXCEEDED",
            `structured output exceeded JSON depth ${this.limits.maximumJsonDepth}`,
          );
        }
      } else if (character === "}" || character === "]") {
        this.depth = Math.max(0, this.depth - 1);
      } else if (
        character === "," &&
        this.root === "array" &&
        this.depth === 1
      ) {
        this.topLevelItems += 1;
        this.assertTopLevelItems();
      }
    }
  }

  finish(): void {
    if (this.mode === "json-lines" && this.lineHasData) {
      this.topLevelItems += 1;
      this.assertTopLevelItems();
    }
  }

  private assertTopLevelItems(): void {
    if (this.topLevelItems > this.limits.maximumTopLevelItems) {
      throw new StructuredOutputLimitError(
        "TOP_LEVEL_ITEMS_EXCEEDED",
        `structured output exceeded ${this.limits.maximumTopLevelItems} top-level items`,
      );
    }
  }
}

export function createStructuredDeadline(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  policy: StructuredTimeoutPolicy = "wall-clock",
): { signal: AbortSignal; recordProgress: () => void; cleanup: () => void } {
  const controller = new AbortController();
  let cleaned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (cleaned || controller.signal.aborted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new StructuredOutputLimitError(
        "ATTEMPT_TIMEOUT",
        policy === "idle"
          ? `structured output idle timeout after ${timeoutMs}ms without meaningful output`
          : `structured output attempt exceeded ${timeoutMs}ms`,
      )),
      timeoutMs,
    );
    timer.unref?.();
  };
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  arm();
  return {
    signal: controller.signal,
    recordProgress: () => {
      if (policy === "idle") arm();
    },
    cleanup: () => {
      cleaned = true;
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

export function structuredContractLogMeta(
  contract: ResolvedStructuredContract,
): Record<string, unknown> {
  return {
    structuredContractId: contract.contractId,
    structuredContractVersion: contract.contractVersion,
    structuredSchemaHash: contract.schemaHash,
    structuredInvocationId: contract.invocationId,
    structuredMode: contract.mode,
    structuredUnknownKeyMode: contract.unknownKeyMode,
    structuredLimits: contract.limits,
    structuredTimeoutPolicy: contract.timeoutPolicy,
    structuredPromptExampleHash: contract.promptExampleHash,
    structuredTransportPolicy: contract.transportPolicy,
    structuredRecoveryPolicy: contract.recoveryPolicy,
    structuredSemanticValidatorId: contract.semanticValidatorId,
  };
}

function resolveJsonSchemaRef(
  root: Record<string, unknown>,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const reference = (value as Record<string, unknown>).$ref;
  if (typeof reference !== "string" || !reference.startsWith("#/"))
    return value;
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      root,
    );
}

function unknownKeyPaths(
  value: unknown,
  schema: unknown,
  root: Record<string, unknown>,
  path: string,
): string[] {
  const resolved = resolveJsonSchemaRef(root, schema);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    return [];
  }
  const node = resolved as Record<string, unknown>;
  const variants = Array.isArray(node.anyOf)
    ? node.anyOf
    : Array.isArray(node.oneOf)
      ? node.oneOf
      : undefined;
  if (variants) {
    const candidates = variants.map((variant) =>
      unknownKeyPaths(value, variant, root, path),
    );
    return (
      candidates.sort((left, right) => left.length - right.length)[0] ?? []
    );
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      unknownKeyPaths(item, node.items, root, `${path}/${index}`),
    );
  }
  if (!value || typeof value !== "object") return [];
  const properties =
    node.properties &&
    typeof node.properties === "object" &&
    !Array.isArray(node.properties)
      ? (node.properties as Record<string, unknown>)
      : undefined;
  if (!properties) return [];
  const additionalProperties = node.additionalProperties;
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => {
      const childPath = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (!(key in properties)) {
        if (additionalProperties === false) return [childPath];
        if (
          additionalProperties &&
          typeof additionalProperties === "object" &&
          !Array.isArray(additionalProperties)
        ) {
          return unknownKeyPaths(child, additionalProperties, root, childPath);
        }
        return [];
      }
      return unknownKeyPaths(child, properties[key], root, childPath);
    },
  );
}

export function findUnknownStructuredKeys(
  value: unknown,
  jsonSchema: Record<string, unknown>,
): string[] {
  return unknownKeyPaths(value, jsonSchema, jsonSchema, "");
}
