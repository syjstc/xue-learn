import type { ObservabilityRepository } from "../../../domain/src/index.js";

let configured: ObservabilityRepository | undefined;

export function configureObservabilityPersistence(repository: ObservabilityRepository): void {
  configured = repository;
}

export function requireObservabilityPersistence(): ObservabilityRepository {
  if (!configured) throw new Error("Observability persistence is not configured");
  return configured;
}
