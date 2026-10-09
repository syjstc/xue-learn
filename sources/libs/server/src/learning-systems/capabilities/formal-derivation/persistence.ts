import type { FormalDerivationRepository } from "../../../../../domain/src/index.js";

let configured: FormalDerivationRepository | undefined;

export function configureFormalDerivationPersistence(
  repository: FormalDerivationRepository | undefined,
): void {
  configured = repository;
}

export function requireFormalDerivationPersistence(): FormalDerivationRepository {
  if (!configured) {
    throw new Error("Formal-derivation persistence is not configured");
  }
  return configured;
}
