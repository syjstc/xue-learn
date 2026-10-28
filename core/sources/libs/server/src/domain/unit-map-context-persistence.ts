import type { UnitMapContextRepository } from "../../../domain/src/index.js";

let repository: UnitMapContextRepository | null = null;

export function configureUnitMapContextPersistence(
  next: UnitMapContextRepository | null,
): void {
  repository = next;
}

export function requireUnitMapContextPersistence(): UnitMapContextRepository {
  if (!repository)
    throw new Error("Unit map context persistence is unavailable");
  return repository;
}
