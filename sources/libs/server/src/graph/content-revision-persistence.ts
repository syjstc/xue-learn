import type { UnitContentRevisionRepository } from "../../../domain/src/index.js";

let repository: UnitContentRevisionRepository | null = null;
export function configureContentRevisionPersistence(
  next: UnitContentRevisionRepository | null,
): void {
  repository = next;
}
export function requireContentRevisionPersistence(): UnitContentRevisionRepository {
  if (!repository)
    throw new Error("Content revision persistence is unavailable");
  return repository;
}
