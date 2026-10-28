import type {
  UserSettingsPatch,
  UserSettingsRepository,
} from "../../domain/src/index.js";

export class StaleUserSessionError extends Error {
  constructor() {
    super("User not found. Please sign in again.");
    this.name = "StaleUserSessionError";
  }
}

let configuredUserSettings: UserSettingsRepository | undefined;

export function configureUserSettingsPersistence(
  repository: UserSettingsRepository | undefined,
): void {
  configuredUserSettings = repository;
}

function persistence(): UserSettingsRepository {
  if (!configuredUserSettings) {
    throw new Error("User-settings persistence is not configured");
  }
  return configuredUserSettings;
}

export function getUserSettingsForUser(userId: string) {
  return persistence().findByUserId(userId);
}

type UserSettingsUpsertData = Readonly<{
  create: UserSettingsPatch;
  update: UserSettingsPatch;
}>;

export async function upsertUserSettingsForUser(
  userId: string,
  data: UserSettingsUpsertData,
): Promise<{ updatedAt: Date }> {
  try {
    const existing = await persistence().findByUserId(userId);
    const result = await persistence().upsert({
      userId,
      patch: existing ? data.update : data.create,
    });
    return { updatedAt: result.updatedAt };
  } catch (error) {
    if (
      error instanceof Error &&
      /foreign key|constraint|user.*not found/i.test(error.message)
    ) {
      throw new StaleUserSessionError();
    }
    throw error;
  }
}
