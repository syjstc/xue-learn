import { AsyncLocalStorage } from "node:async_hooks";

import type { LlmProviderSelection } from "./types.js";

const explicitSelectionScope = new AsyncLocalStorage<LlmProviderSelection>();

/**
 * Run a platform-owned generation call with an explicit provider/model.
 * This is deliberately separate from learner-owned operation routing.
 */
export function withExplicitLlmSelection<T>(
  selection: LlmProviderSelection,
  run: () => T,
): T {
  return explicitSelectionScope.run(selection, run);
}

export function getExplicitLlmSelection(): LlmProviderSelection | undefined {
  return explicitSelectionScope.getStore();
}
