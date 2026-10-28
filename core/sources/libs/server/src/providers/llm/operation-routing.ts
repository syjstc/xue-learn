import { getRuntimeEnvironment } from "../../env.js";
import { listAvailableLlmModels } from "./model-availability.js";
import { type LlmProviderId } from "../../env.js";
import {
  ensureLlmRuntimeConfig,
  type LlmRuntimeConfig,
} from "../../llm/runtime-config.js";
import { ensureOpenAiRuntimeConfig } from "./vendors/openai/runtime-config.js";
import { defaultLlmChatModel } from "./defaults.js";
import { getLlmProviderSpec } from "./registry.js";
import type { LlmProviderSelection } from "./types.js";
import {
  canonicalLlmOperationKey,
  DEFAULT_LLM_OPERATION_KEY,
  getLlmOperationDefinition,
} from "./operation-catalog.js";
import {
  getActiveLlmOperationRoute,
  runLlmOperationRouteScope,
} from "./operation-routing-context.js";
import { requireLlmRoutingPersistence } from "./routing-persistence.js";

export const LLM_ROUTE_CACHE_TTL_MS = 5_000;
export const llmReasoningModes = [
  "inherit",
  "enabled",
  "disabled",
  "auto",
] as const;
export type LlmReasoningMode = (typeof llmReasoningModes)[number];
export type LlmRouteSource = "operation" | "provider_default" | "builtin";

type StoredRoute = {
  provider: string;
  operationKey: string;
  model: string;
  reasoningMode: string;
};

type RouteSnapshot = {
  routes: Map<string, StoredRoute>;
  activeModels: Set<string>;
  expiresAt: number;
};

export type ResolvedLlmOperationRoute = {
  operationKey: string;
  provider: LlmProviderId;
  model: string;
  reasoningMode: Exclude<LlmReasoningMode, "inherit">;
  source: LlmRouteSource;
  configuredOperationModel?: string;
  providerDefaultModel: string;
  selection: LlmProviderSelection;
  outputStarted: boolean;
  fallbackFromModel?: string;
  fallback?: {
    model: string;
    reasoningMode: Exclude<LlmReasoningMode, "inherit">;
    selection: LlmProviderSelection;
    source: LlmRouteSource;
    next?: ResolvedLlmOperationRoute["fallback"];
  };
};

let snapshot: RouteSnapshot | undefined;
let snapshotPromise: Promise<RouteSnapshot> | undefined;

function routeKey(provider: string, operationKey: string): string {
  return `${provider}\u0000${operationKey}`;
}

async function loadSnapshot(): Promise<RouteSnapshot> {
  const [routes, availableModels] = await Promise.all([
    requireLlmRoutingPersistence().listRoutes(),
    listAvailableLlmModels(),
  ]);
  return {
    routes: new Map(
      routes.map((route) => [
        routeKey(route.provider, route.operationKey),
        route,
      ]),
    ),
    activeModels: new Set(
      availableModels
        .map((row) => routeKey(row.provider, row.model)),
    ),
    expiresAt: Date.now() + LLM_ROUTE_CACHE_TTL_MS,
  };
}

export async function getLlmRouteSnapshot(): Promise<RouteSnapshot> {
  if (snapshot && snapshot.expiresAt > Date.now()) return snapshot;
  if (!snapshotPromise) {
    snapshotPromise = loadSnapshot()
      .then((value) => (snapshot = value))
      .finally(() => {
        snapshotPromise = undefined;
      });
  }
  return snapshotPromise;
}

export function invalidateLlmOperationRoutes(): void {
  snapshot = undefined;
  snapshotPromise = undefined;
}

export function supportedReasoningModes(
  provider: LlmProviderId,
  model: string,
): LlmReasoningMode[] {
  if (provider === "doubao") return [...llmReasoningModes];
  if (provider === "deepseek" || provider === "ollama" || provider === "bigmodel") {
    return ["inherit", "enabled", "disabled"];
  }
  if (provider === "minimax" && /^MiniMax-M3$/i.test(model.trim())) {
    return ["inherit", "enabled", "disabled"];
  }
  return ["inherit"];
}

function storedMode(value: string | undefined): LlmReasoningMode {
  return llmReasoningModes.includes(value as LlmReasoningMode)
    ? (value as LlmReasoningMode)
    : "inherit";
}

function routeIsUsable(
  route: StoredRoute | undefined,
  provider: LlmProviderId,
  state: RouteSnapshot,
): route is StoredRoute {
  if (!route || route.provider !== provider) return false;
  const spec = getLlmProviderSpec(provider);
  return (
    spec.models.includes(route.model) &&
    state.activeModels.has(routeKey(provider, route.model))
  );
}

function desktopLocalReasoningMode(
  runtime: LlmRuntimeConfig,
): Exclude<LlmReasoningMode, "inherit"> {
  switch (runtime.provider) {
    case "deepseek":
      return runtime.deepseekThinkingEnabled ? "enabled" : "disabled";
    case "openai":
      return runtime.openaiThinkingEnabled ? "enabled" : "disabled";
    case "codex":
      return runtime.codexReasoningEffort === "none" ? "disabled" : "enabled";
    case "minimax":
      return runtime.minimaxThinkingEnabled ? "enabled" : "disabled";
    case "ollama":
      return runtime.ollamaThinkingEnabled ? "enabled" : "disabled";
    case "doubao":
      return runtime.doubaoThinkingMode;
    case "bigmodel":
      return runtime.bigmodelThinkingEnabled ? "enabled" : "disabled";
    case "custom":
      switch (runtime.customThinkingProtocol) {
        case "deepseek":
          return runtime.deepseekThinkingEnabled ? "enabled" : "disabled";
        case "openai":
          return runtime.openaiThinkingEnabled ? "enabled" : "disabled";
        case "minimax":
          return runtime.minimaxThinkingEnabled ? "enabled" : "disabled";
        case "ollama":
          return runtime.ollamaThinkingEnabled ? "enabled" : "disabled";
        case "doubao":
          return runtime.doubaoThinkingMode;
        case "bigmodel":
          return runtime.bigmodelThinkingEnabled ? "enabled" : "disabled";
        case "qwen":
          return runtime.qwenThinkingEnabled ? "enabled" : "disabled";
        default:
          return "disabled";
      }
    default:
      return "disabled";
  }
}

function applyModelToRuntime(
  runtime: LlmRuntimeConfig,
  model: string,
  reasoningMode: Exclude<LlmReasoningMode, "inherit">,
): LlmProviderSelection {
  return {
    id: runtime.provider,
    model,
    options: {
      chatModel: model,
      embeddingModel: runtime.embeddingModel,
      embeddingProvider: runtime.embeddingProvider,
      minimaxThinkingEnabled: runtime.minimaxThinkingEnabled,
      ollamaThinkingEnabled: runtime.ollamaThinkingEnabled,
      deepseekThinkingEnabled: runtime.deepseekThinkingEnabled,
      openaiThinkingEnabled: runtime.openaiThinkingEnabled,
      codexReasoningEffort: runtime.codexReasoningEffort,
      bigmodelThinkingEnabled: runtime.bigmodelThinkingEnabled,
      qwenThinkingEnabled: runtime.qwenThinkingEnabled,
      doubaoThinkingMode: runtime.doubaoThinkingMode,
      customThinkingProtocol: runtime.customThinkingProtocol,
      routingReasoningMode: reasoningMode,
    },
  };
}

export async function resolveLlmOperationRoute(
  operation: string,
  runtime?: LlmRuntimeConfig,
): Promise<ResolvedLlmOperationRoute> {
  const config = runtime ?? (await ensureLlmRuntimeConfig());
  if (config.provider === "openai") {
    await ensureOpenAiRuntimeConfig();
  }
  const provider = config.provider;
  const operationKey = canonicalLlmOperationKey(operation);
  const definition = getLlmOperationDefinition(operationKey);
  if (!definition && process.env.NODE_ENV !== "test") {
    console.warn(`[llm-routing] unregistered operation: ${operationKey}`);
  }
  if (getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1") {
    const reasoningMode = desktopLocalReasoningMode(config);
    return {
      operationKey,
      provider,
      model: config.chatModel,
      reasoningMode,
      source: "provider_default",
      providerDefaultModel: config.chatModel,
      selection: applyModelToRuntime(config, config.chatModel, reasoningMode),
      outputStarted: false,
    };
  }
  const state = await getLlmRouteSnapshot();
  const operationRoute = state.routes.get(routeKey(provider, operationKey));
  const defaultRoute = state.routes.get(
    routeKey(provider, DEFAULT_LLM_OPERATION_KEY),
  );
  const usableOperation = routeIsUsable(operationRoute, provider, state);
  const usableDefault = routeIsUsable(defaultRoute, provider, state);
  const model = usableOperation
    ? operationRoute.model
    : usableDefault
      ? defaultRoute.model
      : defaultLlmChatModel(provider);
  const source: LlmRouteSource = usableOperation
    ? "operation"
    : usableDefault
      ? "provider_default"
      : "builtin";
  const operationMode = usableOperation
    ? storedMode(operationRoute.reasoningMode)
    : "inherit";
  const defaultMode = usableDefault
    ? storedMode(defaultRoute.reasoningMode)
    : "inherit";
  const reasoningMode: Exclude<LlmReasoningMode, "inherit"> =
    operationMode !== "inherit"
      ? operationMode
      : defaultMode !== "inherit"
        ? defaultMode
        : definition?.defaultReasoning
          ? "enabled"
          : "disabled";
  const fallbackReasoningMode: Exclude<LlmReasoningMode, "inherit"> =
    defaultMode !== "inherit"
      ? defaultMode
      : definition?.defaultReasoning
        ? "enabled"
        : "disabled";
  const providerDefaultModel = usableDefault
    ? defaultRoute.model
    : defaultLlmChatModel(provider);
  const builtInModel = defaultLlmChatModel(provider);
  const builtInReasoningMode: Exclude<LlmReasoningMode, "inherit"> =
    definition?.defaultReasoning ? "enabled" : "disabled";
  const builtInFallback =
    usableDefault && providerDefaultModel !== builtInModel
      ? {
          model: builtInModel,
          reasoningMode: builtInReasoningMode,
          selection: applyModelToRuntime(
            config,
            builtInModel,
            builtInReasoningMode,
          ),
          source: "builtin" as const,
        }
      : undefined;

  return {
    operationKey,
    provider,
    model,
    reasoningMode,
    source,
    configuredOperationModel: operationRoute?.model,
    providerDefaultModel,
    selection: applyModelToRuntime(config, model, reasoningMode),
    outputStarted: false,
    ...(usableOperation && model !== providerDefaultModel
      ? {
          fallback: {
            model: providerDefaultModel,
            reasoningMode: fallbackReasoningMode,
            selection: applyModelToRuntime(
              config,
              providerDefaultModel,
              fallbackReasoningMode,
            ),
            source: usableDefault
              ? ("provider_default" as const)
              : ("builtin" as const),
            ...(builtInFallback ? { next: builtInFallback } : {}),
          },
        }
      : builtInFallback
        ? { fallback: builtInFallback }
        : {}),
  };
}

function isFallbackEligibleError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError")
    return false;
  if (!error || typeof error !== "object") return true;
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const status = Number(candidate.statusCode ?? candidate.status);
  if (status === 401 || status === 403) return false;
  const name = String(candidate.name ?? "");
  return ![
    "AbortError",
    "GenerationCancelledError",
    "InsufficientCreditsError",
    "ZodError",
    "StructuredGenerationError",
    "StructuredNativeOutputError",
  ].includes(name);
}

export async function withLlmOperationRoute<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  const current = getActiveLlmOperationRoute();
  const operationKey = canonicalLlmOperationKey(operation);
  if (current?.operationKey === operationKey) return run();
  const route = await resolveLlmOperationRoute(operationKey);
  let currentRoute = route;
  while (true) {
    try {
      return await runLlmOperationRouteScope(currentRoute, run);
    } catch (error) {
      if (
        !currentRoute.fallback ||
        currentRoute.outputStarted ||
        !isFallbackEligibleError(error)
      ) {
        throw error;
      }
      currentRoute = {
        ...currentRoute,
        model: currentRoute.fallback.model,
        reasoningMode: currentRoute.fallback.reasoningMode,
        selection: currentRoute.fallback.selection,
        source: currentRoute.fallback.source,
        outputStarted: false,
        fallbackFromModel: currentRoute.model,
        fallback: currentRoute.fallback.next,
      };
    }
  }
}
