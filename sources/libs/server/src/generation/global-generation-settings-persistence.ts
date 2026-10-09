import type { GlobalGenerationSettingsRepository } from "../../../domain/src/index.js";

let configured: GlobalGenerationSettingsRepository | undefined;

export function configureGlobalGenerationSettingsPersistence(
  repository: GlobalGenerationSettingsRepository | undefined,
): void {
  configured = repository;
}

export function requireGlobalGenerationSettingsPersistence(): GlobalGenerationSettingsRepository {
  if (!configured) {
    throw new Error("Global generation settings persistence is unavailable");
  }
  return configured;
}
