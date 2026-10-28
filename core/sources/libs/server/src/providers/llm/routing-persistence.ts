import type { LlmRoutingRepository } from "../../../../domain/src/index.js";

let configured: LlmRoutingRepository | undefined;

export function configureLlmRoutingPersistence(
  repository: LlmRoutingRepository | undefined,
): void {
  configured = repository;
}

export function requireLlmRoutingPersistence(): LlmRoutingRepository {
  if (!configured) throw new Error("LLM routing persistence is unavailable");
  return configured;
}
