import { z } from "zod";
import {
  getUserSettingsForUser,
  upsertUserSettingsForUser,
} from "../user-settings.js";

export const LOCAL_RAG_MAX_CHUNKS_MIN = 1;
export const LOCAL_RAG_MAX_CHUNKS_MAX = 10_000;

export const localRuntimeSettingsSchema = z
  .object({
    ragMaxChunksPerUpload: z
      .number()
      .int()
      .min(LOCAL_RAG_MAX_CHUNKS_MIN)
      .max(LOCAL_RAG_MAX_CHUNKS_MAX)
      .optional(),
  })
  .strict();

export type LocalRuntimeSettings = z.infer<typeof localRuntimeSettingsSchema>;

export async function readLocalRuntimeSettings(
  userId: string,
): Promise<LocalRuntimeSettings> {
  const row = await getUserSettingsForUser(userId);
  try {
    const raw = JSON.parse(row?.localRuntimeSettingsJson ?? "{}");
    const parsed = localRuntimeSettingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function saveLocalRuntimeSettings(
  userId: string,
  settings: LocalRuntimeSettings,
): Promise<void> {
  const value = localRuntimeSettingsSchema.parse(settings);
  const json = JSON.stringify(value);
  await upsertUserSettingsForUser(userId, {
    create: { localRuntimeSettingsJson: json },
    update: { localRuntimeSettingsJson: json },
  });
}
