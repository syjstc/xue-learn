import type { ModuleStructureDraftRepository } from "../../../domain/src/index.js";

let configured: ModuleStructureDraftRepository | undefined;

export function configureModuleStructureDraftPersistence(
  persistence: ModuleStructureDraftRepository | undefined,
): void {
  configured = persistence;
}

export function requireModuleStructureDraft(): ModuleStructureDraftRepository {
  if (!configured) {
    throw new Error("Module structure draft persistence is not configured");
  }
  return configured;
}

export function getModuleStructureDraft():
  | ModuleStructureDraftRepository
  | undefined {
  return configured;
}
