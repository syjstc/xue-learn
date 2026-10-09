import {
  guidedImageModelSettingsSchema,
  type GuidedImageModelSettings,
} from "../../../runtime-contracts/src/index.js";
import {
  getUserSettingsForUser,
  upsertUserSettingsForUser,
} from "../user-settings.js";

const PREFERENCE_KEY = "guidedImageModel";

function preferences(raw?: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function guidedImageModelFromPreferences(
  raw?: string | null,
): GuidedImageModelSettings {
  const parsed = guidedImageModelSettingsSchema.safeParse(
    preferences(raw)[PREFERENCE_KEY],
  );
  return parsed.success ? parsed.data : { mode: "auto" };
}

export async function saveGuidedImageModelSettings(
  userId: string,
  settings: GuidedImageModelSettings,
): Promise<void> {
  const row = await getUserSettingsForUser(userId);
  const next = preferences(row?.clientPreferencesJson);
  next[PREFERENCE_KEY] = guidedImageModelSettingsSchema.parse(settings);
  const clientPreferencesJson = JSON.stringify(next);
  await upsertUserSettingsForUser(userId, {
    create: { clientPreferencesJson },
    update: { clientPreferencesJson },
  });
}
