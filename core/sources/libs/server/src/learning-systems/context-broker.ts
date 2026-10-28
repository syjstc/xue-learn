import {
  DEFAULT_ACTIVATION_RESOLVER,
  type LearningSystemActivationResolver,
} from "./activation.js";
import { LearningSystemRegistry } from "./registry.js";
import {
  CAPABILITY_PROMPT_LAYER_ORDER,
  type ContextEnvelope,
  type ContextResolutionDiagnostic,
  type EagerViewProfile,
  type GenerationContextProfile,
  type LearningSystemSubject,
  type ResolvedContextView,
  type ResolvedGenerationContext,
} from "./types.js";

export type ContextResolutionRequest = {
  operation?: string;
  profile: GenerationContextProfile;
  subject: LearningSystemSubject;
  query?: string;
  invocation?: unknown;
  signal?: AbortSignal;
};

export type ContextBrokerOptions = {
  activationResolver?: LearningSystemActivationResolver;
  estimateTokens?: (data: unknown) => number;
};

export class ContextResolutionError extends Error {
  constructor(
    message: string,
    readonly result: ResolvedGenerationContext,
  ) {
    super(message);
    this.name = "ContextResolutionError";
  }
}

function defaultEstimateTokens(data: unknown): number {
  if (data === undefined || data === null) return 0;
  let serialized: string;
  try {
    serialized = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    serialized = String(data);
  }
  return Math.ceil(serialized.length / 4);
}

function isScopeCompatible(
  expected: LearningSystemSubject,
  actual: LearningSystemSubject,
): boolean {
  for (const key of [
    "userId",
    "goalId",
    "moduleId",
    "unitId",
    "threadId",
  ] as const) {
    // A capability may expose a view at a broader authoritative scope than the
    // invocation (for example a user-scoped learner profile during a
    // thread-scoped agent turn). Every identity the capability does claim must
    // still be present in, and exactly match, the server-resolved subject.
    if (actual[key] !== undefined && actual[key] !== expected[key]) {
      return false;
    }
  }
  return true;
}

function diagnostic(
  profile: EagerViewProfile,
  code: ContextResolutionDiagnostic["code"],
  message: string,
): ContextResolutionDiagnostic {
  return {
    key: profile.key,
    code,
    required: profile.required,
    message,
  };
}

type ViewAttempt =
  | { profile: EagerViewProfile; envelope: ContextEnvelope }
  | { profile: EagerViewProfile; diagnostic: ContextResolutionDiagnostic };

const AUTHORITY_ORDER = [
  "server_policy",
  "objective_definition",
  "verified_learner_state",
  "verified_source",
  "learner_declared_context",
  "pedagogical_guidance",
  "conversation_context",
] as const;

function orderResolvedViews(
  candidates: ResolvedContextView[],
): ResolvedContextView[] {
  return [...candidates].sort((left, right) => {
    const leftLayer = left.profile.promptLayer
      ? CAPABILITY_PROMPT_LAYER_ORDER.indexOf(left.profile.promptLayer)
      : -1;
    const rightLayer = right.profile.promptLayer
      ? CAPABILITY_PROMPT_LAYER_ORDER.indexOf(right.profile.promptLayer)
      : -1;
    if (leftLayer >= 0 || rightLayer >= 0) {
      const byLayer =
        (leftLayer >= 0 ? leftLayer : Number.MAX_SAFE_INTEGER) -
        (rightLayer >= 0 ? rightLayer : Number.MAX_SAFE_INTEGER);
      if (byLayer !== 0) return byLayer;
      if (leftLayer >= 0 && rightLayer >= 0) {
        const byPromptOrder =
          (left.profile.promptOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.profile.promptOrder ?? Number.MAX_SAFE_INTEGER);
        return (
          byPromptOrder || left.profile.key.localeCompare(right.profile.key)
        );
      }
    }
    const byAuthority =
      AUTHORITY_ORDER.indexOf(left.envelope.authority) -
      AUTHORITY_ORDER.indexOf(right.envelope.authority);
    return byAuthority || left.profile.key.localeCompare(right.profile.key);
  });
}

/**
 * Resolves operation-declared eager context. It selects complete envelopes
 * rather than truncating structured capability payloads, leaving schema-aware
 * compaction to the owning capability.
 */
export class ContextBroker {
  private readonly activationResolver: LearningSystemActivationResolver;
  private readonly estimateTokens: (data: unknown) => number;

  constructor(
    private readonly registry: LearningSystemRegistry,
    options: ContextBrokerOptions = {},
  ) {
    this.activationResolver =
      options.activationResolver ?? DEFAULT_ACTIVATION_RESOLVER;
    this.estimateTokens = options.estimateTokens ?? defaultEstimateTokens;
  }

  async resolve(
    request: ContextResolutionRequest,
  ): Promise<ResolvedGenerationContext> {
    this.assertProfile(request.profile);

    const attempts = await Promise.all(
      request.profile.eagerViews.map((profile) =>
        this.resolveView(profile, request),
      ),
    );

    const diagnostics: ContextResolutionDiagnostic[] = [];
    const candidates: ResolvedContextView[] = [];
    for (const attempt of attempts) {
      if ("diagnostic" in attempt) {
        diagnostics.push(attempt.diagnostic);
        continue;
      }
      const estimatedTokens = this.estimateTokens(attempt.envelope.data);
      if (estimatedTokens > attempt.profile.maxTokens) {
        diagnostics.push(
          diagnostic(
            attempt.profile,
            "over_budget",
            `View "${attempt.profile.key}" requires approximately ${estimatedTokens} tokens, exceeding its ${attempt.profile.maxTokens} token budget`,
          ),
        );
        continue;
      }
      candidates.push({
        profile: attempt.profile,
        envelope: attempt.envelope,
        estimatedTokens,
        truncated: false,
      });
    }

    const orderedCandidates = orderResolvedViews(candidates);
    const required = orderedCandidates.filter(
      (candidate) => candidate.profile.required,
    );
    const requiredTokens = required.reduce(
      (total, candidate) => total + candidate.estimatedTokens,
      0,
    );

    if (requiredTokens > request.profile.maxEagerContextTokens) {
      for (const candidate of required) {
        diagnostics.push(
          diagnostic(
            candidate.profile,
            "over_budget",
            `Required views exceed the total ${request.profile.maxEagerContextTokens} token budget`,
          ),
        );
      }
    }

    const selected: ResolvedContextView[] = [];
    let estimatedTokens =
      requiredTokens > request.profile.maxEagerContextTokens
        ? 0
        : requiredTokens;

    for (const candidate of orderedCandidates) {
      if (candidate.profile.required) {
        if (requiredTokens <= request.profile.maxEagerContextTokens) {
          selected.push(candidate);
        }
        continue;
      }
      if (
        estimatedTokens + candidate.estimatedTokens >
        request.profile.maxEagerContextTokens
      ) {
        diagnostics.push(
          diagnostic(
            candidate.profile,
            "over_budget",
            `View "${candidate.profile.key}" does not fit the remaining eager-context budget`,
          ),
        );
        continue;
      }
      selected.push(candidate);
      estimatedTokens += candidate.estimatedTokens;
    }

    diagnostics.sort((left, right) => left.key.localeCompare(right.key));

    const result: ResolvedGenerationContext = {
      views: selected,
      diagnostics,
      estimatedTokens,
    };
    const blocking = diagnostics.filter((entry) => entry.required);
    if (blocking.length > 0) {
      throw new ContextResolutionError(
        `Required generation context could not be resolved: ${blocking
          .map((entry) => `${entry.key} (${entry.code})`)
          .join(", ")}`,
        result,
      );
    }
    return result;
  }

  private async resolveView(
    profile: EagerViewProfile,
    request: ContextResolutionRequest,
  ): Promise<ViewAttempt> {
    const provider = this.registry.getViewProvider(profile.key);
    if (!provider?.getView) {
      return {
        profile,
        diagnostic: diagnostic(
          profile,
          "not_registered",
          `No capability provides view "${profile.key}"`,
        ),
      };
    }

    let effectiveProfile = profile;
    if (this.activationResolver.isViewRequired) {
      try {
        const requirement = this.activationResolver.isViewRequired({
          capability: provider,
          subject: request.subject,
          profile,
        });
        const required =
          typeof requirement === "boolean" ? requirement : await requirement;
        effectiveProfile =
          required === profile.required ? profile : { ...profile, required };
      } catch (error) {
        return {
          profile,
          diagnostic: diagnostic(
            profile,
            "unavailable",
            `Requirement policy failed for "${profile.key}": ${String(error)}`,
          ),
        };
      }
    }

    let active: boolean;
    try {
      active = await this.activationResolver.isActive({
        capability: provider,
        subject: request.subject,
      });
    } catch (error) {
      return {
        profile,
        diagnostic: diagnostic(
          profile,
          "unavailable",
          `Activation policy failed for "${profile.key}": ${String(error)}`,
        ),
      };
    }
    if (!active) {
      return {
        profile: effectiveProfile,
        diagnostic: diagnostic(
          effectiveProfile,
          "not_active",
          `Capability "${provider.manifest.id}" is not active for view "${profile.key}"`,
        ),
      };
    }

    let envelope: ContextEnvelope | null;
    try {
      envelope = await provider.getView({
        key: profile.key,
        operation: request.operation,
        subject: { ...request.subject },
        query: request.query,
        invocation: request.invocation,
        signal: request.signal,
      });
    } catch (error) {
      return {
        profile: effectiveProfile,
        diagnostic: diagnostic(
          effectiveProfile,
          "unavailable",
          `Capability "${provider.manifest.id}" failed to resolve "${profile.key}": ${String(error)}`,
        ),
      };
    }
    if (!envelope) {
      return {
        profile: effectiveProfile,
        diagnostic: diagnostic(
          effectiveProfile,
          "unavailable",
          `Capability "${provider.manifest.id}" returned no data for "${profile.key}"`,
        ),
      };
    }
    if (
      envelope.ownerCapabilityId !== provider.manifest.id ||
      envelope.ownerCapabilityVersion !== provider.manifest.version ||
      !isScopeCompatible(request.subject, envelope.scope)
    ) {
      return {
        profile: effectiveProfile,
        diagnostic: diagnostic(
          effectiveProfile,
          "unavailable",
          `Capability "${provider.manifest.id}" returned an invalid owner, version, or subject scope for "${profile.key}"`,
        ),
      };
    }
    if (envelope.freshness.stale && !effectiveProfile.allowStale) {
      return {
        profile: effectiveProfile,
        diagnostic: diagnostic(
          effectiveProfile,
          "stale",
          `View "${profile.key}" is stale and this operation requires fresh data`,
        ),
      };
    }
    return { profile: effectiveProfile, envelope };
  }

  private assertProfile(profile: GenerationContextProfile): void {
    if (
      !Number.isFinite(profile.maxEagerContextTokens) ||
      profile.maxEagerContextTokens < 0
    ) {
      throw new Error("maxEagerContextTokens must be a non-negative number");
    }
    const seen = new Set<string>();
    for (const view of profile.eagerViews) {
      if (seen.has(view.key)) {
        throw new Error(`Duplicate eager view profile "${view.key}"`);
      }
      seen.add(view.key);
      if (!Number.isFinite(view.maxTokens) || view.maxTokens < 0) {
        throw new Error(
          `maxTokens for eager view "${view.key}" must be non-negative`,
        );
      }
    }
  }
}
