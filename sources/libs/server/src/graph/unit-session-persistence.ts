import type { UnitSessionStateRepository } from "../../../domain/src/index.js";

let repository: UnitSessionStateRepository | null = null;

export function configureUnitSessionPersistence(
  next: UnitSessionStateRepository | null,
): void {
  repository = next;
}

export function requireUnitSessionPersistence(): UnitSessionStateRepository {
  if (!repository) throw new Error("Unit session persistence is unavailable");
  return repository;
}
