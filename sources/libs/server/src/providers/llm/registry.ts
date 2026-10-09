import type { LlmProviderId } from "../../env.js";
import { buildProviderRegistry } from "../core/registry.js";
import { LLM_PROVIDER_SPECS, type LlmProviderSpec } from "./specs.js";

export const LLM_PROVIDER_REGISTRY = buildProviderRegistry(LLM_PROVIDER_SPECS);

export function getLlmProviderSpec(id: LlmProviderId): LlmProviderSpec {
  return LLM_PROVIDER_REGISTRY[id];
}
