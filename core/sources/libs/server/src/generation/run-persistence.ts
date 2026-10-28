import type { AiGenerationRunRepository } from "../../../domain/src/index.js";

let repository: AiGenerationRunRepository | null = null;
export function configureGenerationRunPersistence(
  next: AiGenerationRunRepository | null,
): void {
  repository = next;
}
export function requireGenerationRunPersistence(): AiGenerationRunRepository {
  if (!repository) throw new Error("Generation run persistence is unavailable");
  return repository;
}
