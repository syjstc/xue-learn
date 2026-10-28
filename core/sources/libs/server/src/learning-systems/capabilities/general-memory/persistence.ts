import type { GeneralMemoryRepositoryPort } from "../../../../../domain/src/index.js";

let configured: GeneralMemoryRepositoryPort | undefined;

export function configureGeneralMemoryPersistence(
  repository: GeneralMemoryRepositoryPort | undefined,
): void {
  configured = repository;
}

export function requireGeneralMemoryPersistence(): GeneralMemoryRepositoryPort {
  if (!configured)
    throw new Error("General-memory persistence is not configured");
  return configured;
}
