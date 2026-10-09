import type { TeachingDerivationRepository } from "../../../../../domain/src/index.js";

let configured: TeachingDerivationRepository | undefined;

export function configureTeachingDerivationPersistence(
  repository: TeachingDerivationRepository | undefined,
): void {
  configured = repository;
}

export function requireTeachingDerivationPersistence(): TeachingDerivationRepository {
  if (!configured) {
    throw new Error("Teaching-derivation persistence is not configured");
  }
  return configured;
}
