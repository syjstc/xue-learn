import { AsyncLocalStorage } from "node:async_hooks";
import type { ResolvedLlmOperationRoute } from "./operation-routing.js";

const routeScope = new AsyncLocalStorage<ResolvedLlmOperationRoute>();

export function runLlmOperationRouteScope<T>(
  route: ResolvedLlmOperationRoute,
  run: () => Promise<T>,
): Promise<T> {
  return routeScope.run(route, run);
}

export function getActiveLlmOperationRoute():
  | ResolvedLlmOperationRoute
  | undefined {
  return routeScope.getStore();
}

export function markActiveLlmRouteOutputStarted(): void {
  const route = routeScope.getStore();
  if (route) route.outputStarted = true;
}

export function activeLlmRouteLogMeta(): Record<string, unknown> {
  const route = routeScope.getStore();
  if (!route) return {};
  return {
    llmOperationKey: route.operationKey,
    llmRouteSource: route.source,
    llmRouteModel: route.model,
    llmReasoningMode: route.reasoningMode,
    ...(route.fallbackFromModel
      ? { llmRouteFallbackFromModel: route.fallbackFromModel }
      : {}),
  };
}
