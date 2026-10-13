import { getActivePresentationCapabilities, runWithPresentationCapabilities } from "../llm/display-capabilities.js";
import type { PresentationCapabilities } from "../../../domain/src/presentation-capabilities.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  CapabilityContextSemanticClass,
  CapabilityPromptLayer,
  ContextEnvelope,
  LearningSystemSubject,
} from "../learning-systems/types.js";
import { recordActiveOperationTelemetry } from "./execution/evidence-collector.js";
import {
  buildPromptPrefixBoundaries,
  formatContextEntry,
  hashPromptPrefix,
  isDoubaoSelectedPrefixCacheEnabled,
  PROMPT_PREFIX_FORMAT_VERSION,
  selectPromptPrefixBoundary,
  selectedPromptPrefix,
  type PromptPrefixScope,
} from "./prompt-prefix.js";
import { preferredPromptPrefixScope } from "./prompt-prefix-scope.js";

export type GenerationContextMode = "legacy" | "shadow" | "enforced";

export type GenerationContextScope = {
  subject: LearningSystemSubject;
  query?: string;
  invocation?: unknown;
  presentationCapabilities?: PresentationCapabilities;
};

export type GenerationContextContribution = {
  viewKey: string;
  envelope: ContextEnvelope;
  rendered: string;
  estimatedTokens: number;
  truncated?: boolean;
  promptLayer?: CapabilityPromptLayer;
  promptOrder?: number;
  semanticClass?: CapabilityContextSemanticClass;
};

export type GenerationContextResolution = {
  contributions: GenerationContextContribution[];
  diagnostics?: Array<{
    key: string;
    code: string;
    message: string;
  }>;
};

export type GenerationContextResolver = (request: {
  operation: string;
  scope: GenerationContextScope;
}) => Promise<GenerationContextResolution>;

export type PreparedGenerationInvocation = {
  prompt: string;
  contextMeta: Record<string, unknown>;
};

const contextScope = new AsyncLocalStorage<GenerationContextScope>();
let resolver: GenerationContextResolver | undefined;
let defaultRuntimeInitialization: Promise<void> | undefined;

export function configureGenerationContextResolver(
  nextResolver: GenerationContextResolver | undefined,
): void {
  resolver = nextResolver;
  if (!nextResolver) defaultRuntimeInitialization = undefined;
}

function mergeGenerationContextScope(
  parent: GenerationContextScope | undefined,
  child: GenerationContextScope,
): GenerationContextScope {
  if (
    parent?.subject.userId &&
    child.subject.userId &&
    parent.subject.userId !== child.subject.userId
  ) {
    throw new Error("Nested generation context cannot change user identity");
  }
  return {
    subject: {
      ...(parent?.subject ?? {}),
      ...(child.subject.userId !== undefined
        ? { userId: child.subject.userId }
        : {}),
      ...(child.subject.goalId !== undefined
        ? { goalId: child.subject.goalId }
        : {}),
      ...(child.subject.moduleId !== undefined
        ? { moduleId: child.subject.moduleId }
        : {}),
      ...(child.subject.unitId !== undefined
        ? { unitId: child.subject.unitId }
        : {}),
      ...(child.subject.threadId !== undefined
        ? { threadId: child.subject.threadId }
        : {}),
    },
    query: child.query ?? parent?.query,
    invocation: child.invocation ?? parent?.invocation,
    presentationCapabilities: child.presentationCapabilities ?? parent?.presentationCapabilities ?? getActivePresentationCapabilities(),
  };
}

export async function runGenerationContextScope<T>(
  scope: GenerationContextScope,
  run: () => Promise<T>,
): Promise<T> {
  const merged = mergeGenerationContextScope(contextScope.getStore(), scope);
  return contextScope.run(merged, () => runWithPresentationCapabilities(merged.presentationCapabilities, run));
}

/**
 * Narrows a workflow nested inside an assistant run while retaining outer
 * thread context. A child may add or refine goal/module/unit scope, but it may
 * never switch the authenticated learner identity.
 */
export async function runMergedGenerationContextScope<T>(
  child: GenerationContextScope,
  run: () => Promise<T>,
): Promise<T> {
  const merged = mergeGenerationContextScope(contextScope.getStore(), child);
  return contextScope.run(merged, () => runWithPresentationCapabilities(merged.presentationCapabilities, run));
}

export function getActiveGenerationContextScope():
  GenerationContextScope | undefined {
  return contextScope.getStore();
}

export function resolveGenerationContextMode(
  value = process.env.GENERATION_CONTEXT_MODE,
): GenerationContextMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "legacy" || normalized === "shadow") return normalized;
  return "enforced";
}

export async function prepareGenerationInvocation(
  operation: string,
  prompt: string,
  contextResolver?: GenerationContextResolver,
): Promise<PreparedGenerationInvocation> {
  const mode = resolveGenerationContextMode();
  const scope = contextScope.getStore() ?? { subject: {} };
  if (!contextResolver && !resolver) {
    try {
      if (!defaultRuntimeInitialization) {
        defaultRuntimeInitialization =
          import("../learning-systems/default-runtime.js").then(
            ({ getDefaultLearningSystemRuntime }) => {
              getDefaultLearningSystemRuntime();
            },
          );
      }
      await defaultRuntimeInitialization;
    } catch {
      defaultRuntimeInitialization = undefined;
    }
  }
  const activeResolver = contextResolver ?? resolver;
  if (!activeResolver) {
    return {
      prompt,
      contextMeta: {
        generationContextMode: mode,
        generationContextApplied: false,
        generationContextBypassReason: "resolver_unavailable",
        generationContextViewCount: 0,
        generationContextCapabilityUsage: [],
        promptPrefixFormatVersion: PROMPT_PREFIX_FORMAT_VERSION,
        promptPrefixBoundaries: [],
        promptPrefixExplicitEnabled: isDoubaoSelectedPrefixCacheEnabled(),
      },
    };
  }

  const resolutionStartedAt = Date.now();
  const resolution = await activeResolver({ operation, scope });
  const resolutionMs = Date.now() - resolutionStartedAt;
  const formattedContributions = resolution.contributions.map(
    (contribution) => ({
      ...contribution,
      formatted: formatContextEntry(contribution),
    }),
  );
  const { block, boundaries } = buildPromptPrefixBoundaries(
    formattedContributions.map(
      ({ viewKey, promptLayer, estimatedTokens, formatted }) => ({
        viewKey,
        promptLayer,
        estimatedTokens,
        formatted,
      }),
    ),
  );
  const preferredScope: PromptPrefixScope = preferredPromptPrefixScope(
    operation,
    scope.subject,
  );
  const selectedBoundary = selectPromptPrefixBoundary(
    boundaries,
    preferredScope,
  );
  const composedPrompt = block
    ? prompt
      ? `${block}\n\n${prompt}`
      : block
    : prompt;
  let cumulativeEstimatedTokens = 0;
  const capabilityUsage = formattedContributions.map(
    ({
      viewKey,
      envelope,
      rendered,
      estimatedTokens,
      truncated,
      promptLayer,
      promptOrder,
      semanticClass,
      formatted,
    }) => {
      cumulativeEstimatedTokens += estimatedTokens;
      return {
        type: "eager_view",
        key: viewKey,
        capabilityId: envelope.ownerCapabilityId,
        capabilityVersion: envelope.ownerCapabilityVersion,
        schemaVersion: envelope.schemaVersion,
        authority: envelope.authority,
        ...(promptLayer ? { promptLayer } : {}),
        ...(promptOrder !== undefined ? { promptOrder } : {}),
        ...(semanticClass ? { semanticClass } : {}),
        subjectScope: envelope.scope,
        contentHash: hashPromptPrefix(formatted),
        stale: envelope.freshness.stale,
        estimatedTokens,
        cumulativeEstimatedTokens,
        truncated: Boolean(truncated),
        content: envelope.data,
        renderedContent: rendered,
        formatted,
      };
    },
  );
  const explicitEnabled = isDoubaoSelectedPrefixCacheEnabled();
  const contextMeta = {
    generationContextMode: mode,
    generationContextApplied: true,
    generationContextViewCount: resolution.contributions.length,
    generationContextOwners: resolution.contributions.map(
      ({ envelope }) =>
        `${envelope.ownerCapabilityId}@${envelope.ownerCapabilityVersion}`,
    ),
    generationContextSchemas: resolution.contributions.map(
      ({ envelope }) =>
        `${envelope.ownerCapabilityId}:${envelope.schemaVersion}`,
    ),
    generationContextCapabilityUsage: capabilityUsage,
    generationContextStaleCount: resolution.contributions.filter(
      ({ envelope }) => envelope.freshness.stale,
    ).length,
    generationContextEstimatedTokens: resolution.contributions.reduce(
      (sum, item) => sum + item.estimatedTokens,
      0,
    ),
    generationContextTruncatedCount: resolution.contributions.filter(
      (item) => item.truncated,
    ).length,
    generationContextDiagnostics: resolution.diagnostics?.map(
      ({ key, code, message }) => ({ key, code, message }),
    ),
    generationContextResolutionMs: resolutionMs,
    generationContextAddedChars: block.length,
    generationContextLegacyPromptHash: hashPromptPrefix(prompt),
    generationContextComposedPromptHash: hashPromptPrefix(composedPrompt),
    promptPrefixFormatVersion: PROMPT_PREFIX_FORMAT_VERSION,
    promptPrefixBoundaries: boundaries,
    promptPrefixPreferredScope: preferredScope,
    promptPrefixSelectedScope: selectedBoundary?.scope,
    promptPrefixSelectedHash: selectedBoundary?.hash,
    promptPrefixSelectedChars: selectedBoundary?.chars,
    promptPrefixSelectedTokens: selectedBoundary?.estimatedTokens,
    promptPrefixExplicitEnabled: explicitEnabled,
    promptPrefixProviderEligible:
      explicitEnabled &&
      typeof selectedBoundary?.chars === "number" &&
      selectedBoundary.chars >= 4_096,
  };

  recordActiveOperationTelemetry({
    type: "context",
    viewKeys: resolution.contributions.map(({ viewKey }) => viewKey),
    toolKeys: [],
    truncatedViewCount: resolution.contributions.filter(
      (item) => item.truncated,
    ).length,
    promptHash: hashPromptPrefix(composedPrompt),
    contextBoundaryHash: selectedBoundary?.hash,
  });

  return {
    prompt: composedPrompt,
    contextMeta,
  };
}

/**
 * Return the selected reusable prefix at the start of a composed prompt.
 * Providers register exactly one explicit cache for this byte range.
 */
export function generationContextPromptPrefix(
  prompt: string,
  contextMeta: Record<string, unknown>,
): string | undefined {
  if (contextMeta.promptPrefixExplicitEnabled === false) return undefined;
  const selected = contextMeta.promptPrefixSelectedScope
    ? {
        scope: contextMeta.promptPrefixSelectedScope as PromptPrefixScope,
        chars: Number(contextMeta.promptPrefixSelectedChars),
        hash: String(contextMeta.promptPrefixSelectedHash ?? ""),
        estimatedTokens: Number(contextMeta.promptPrefixSelectedTokens ?? 0),
        viewKeys: [],
      }
    : undefined;
  const selectedText = selectedPromptPrefix(
    prompt,
    selected && Number.isInteger(selected.chars) ? selected : undefined,
  );
  if (selectedText) return selectedText;
  const addedChars = contextMeta.generationContextAddedChars;
  if (
    typeof addedChars !== "number" ||
    !Number.isInteger(addedChars) ||
    addedChars <= 0 ||
    addedChars > prompt.length
  ) {
    return undefined;
  }
  return prompt.slice(0, addedChars);
}

export {
  PROMPT_PREFIX_FORMAT_VERSION,
  isDoubaoSelectedPrefixCacheEnabled,
} from "./prompt-prefix.js";
