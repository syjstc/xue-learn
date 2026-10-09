import { createHash } from "node:crypto";
import type { CapabilityPromptLayer } from "../learning-systems/types.js";

/** Bump when prompt-layer order or header format changes so caches invalidate on purpose. */
export const PROMPT_PREFIX_FORMAT_VERSION = "v4";

export const PROMPT_PREFIX_SCOPES = Object.freeze([
  "platform",
  "learner",
  "goal",
  "module",
  "unit",
] as const);

export type PromptPrefixScope = (typeof PROMPT_PREFIX_SCOPES)[number];

export type PromptPrefixBoundary = {
  scope: PromptPrefixScope;
  chars: number;
  hash: string;
  estimatedTokens: number;
  viewKeys: string[];
};

export const CONTEXT_BLOCK_HEADER = `[Learning system context — server supplied; prefix=${PROMPT_PREFIX_FORMAT_VERSION}]`;

const CONTEXT_BLOCK_FOOTER = "[End learning system context]";

const LAYER_TO_PREFIX_SCOPE: Partial<
  Record<CapabilityPromptLayer, PromptPrefixScope>
> = {
  platform_policy: "platform",
  learner_context: "learner",
  reusable_guidance: "learner",
  reusable_feature_policy: "learner",
  goal_context: "goal",
  module_context: "module",
  unit_context: "unit",
};

export function promptPrefixScopeForLayer(
  layer: CapabilityPromptLayer | undefined,
): PromptPrefixScope | undefined {
  if (!layer) return undefined;
  return LAYER_TO_PREFIX_SCOPE[layer];
}

export function hashPromptPrefix(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isDoubaoSelectedPrefixCacheEnabled(
  value = process.env.XUELEARN_DOUBAO_SELECTED_PREFIX_CACHE,
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "telemetry"
  ) {
    return false;
  }
  return true;
}

export function formatContextEntry(input: {
  envelope: {
    authority: string;
    ownerCapabilityId: string;
    ownerCapabilityVersion: string;
    schemaVersion: number;
  };
  rendered: string;
}): string {
  return `[${input.envelope.authority}; owner=${input.envelope.ownerCapabilityId}@${input.envelope.ownerCapabilityVersion}; schema=${input.envelope.schemaVersion}]\n${input.rendered.trim()}`;
}

export function formatContextBlock(entries: string[]): string {
  const body = entries.filter(Boolean).join("\n\n");
  return body
    ? `${CONTEXT_BLOCK_HEADER}\n${body}\n${CONTEXT_BLOCK_FOOTER}`
    : "";
}

export function buildPromptPrefixBoundaries(
  contributions: ReadonlyArray<{
    viewKey: string;
    promptLayer?: CapabilityPromptLayer;
    estimatedTokens: number;
    formatted: string;
  }>,
): {
  block: string;
  boundaries: PromptPrefixBoundary[];
} {
  if (contributions.length === 0) {
    return { block: "", boundaries: [] };
  }
  const formattedEntries = contributions.map((item) => item.formatted);
  const block = formatContextBlock(formattedEntries);
  const boundaries: PromptPrefixBoundary[] = [];
  const viewKeys: string[] = [];
  let estimatedTokens = 0;
  let currentScope: PromptPrefixScope | undefined;
  let prefixBody = "";

  const flush = (scope: PromptPrefixScope) => {
    const prefix = `${CONTEXT_BLOCK_HEADER}\n${prefixBody}`;
    boundaries.push({
      scope,
      chars: prefix.length,
      hash: hashPromptPrefix(prefix),
      estimatedTokens,
      viewKeys: [...viewKeys],
    });
  };

  for (const contribution of contributions) {
    const nextScope = promptPrefixScopeForLayer(contribution.promptLayer);
    if (!nextScope) {
      if (currentScope) {
        flush(currentScope);
        currentScope = undefined;
      }
      continue;
    }
    if (
      currentScope &&
      nextScope !== currentScope &&
      PROMPT_PREFIX_SCOPES.indexOf(nextScope) >
        PROMPT_PREFIX_SCOPES.indexOf(currentScope)
    ) {
      flush(currentScope);
    }
    prefixBody = prefixBody
      ? `${prefixBody}\n\n${contribution.formatted}`
      : contribution.formatted;
    viewKeys.push(contribution.viewKey);
    estimatedTokens += contribution.estimatedTokens;
    currentScope = nextScope;
  }
  if (currentScope) flush(currentScope);
  return { block, boundaries };
}

export function selectPromptPrefixBoundary(
  boundaries: readonly PromptPrefixBoundary[],
  preferred: PromptPrefixScope,
): PromptPrefixBoundary | undefined {
  if (boundaries.length === 0) return undefined;
  const preferredIndex = PROMPT_PREFIX_SCOPES.indexOf(preferred);
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const boundary = boundaries[index]!;
    if (PROMPT_PREFIX_SCOPES.indexOf(boundary.scope) <= preferredIndex) {
      return boundary;
    }
  }
  return boundaries[0];
}

export function selectedPromptPrefix(
  prompt: string,
  selected: PromptPrefixBoundary | undefined,
): string | undefined {
  if (!selected || selected.chars <= 0 || selected.chars > prompt.length) {
    return undefined;
  }
  const prefix = prompt.slice(0, selected.chars);
  if (hashPromptPrefix(prefix) !== selected.hash) return undefined;
  return prefix;
}

export function cacheTelemetryStatus(value: number | null | undefined):
  | { status: "unknown"; reason: "missing_provider_telemetry" }
  | {
      status: "known";
      value: number;
    } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { status: "known", value };
  }
  return { status: "unknown", reason: "missing_provider_telemetry" };
}
