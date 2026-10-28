import { z } from "zod";
import { getUserSettingsForUser } from "../../user-settings.js";
import type {
  CapabilityQueryTool,
  CapabilitySettingsPort,
  LearningSystemCapability,
} from "../types.js";
import {
  VERSION,
  SCHEMA_VERSION,
  BUILTIN_READ_QUERY_TOOL_KEYS,
  preferencesResultSchema,
  iso,
  abortIfNeeded,
  envelope,
  type BuiltinReadCapabilityDependencies,
} from "./support/builtin.js";

export function createLearningExperienceCapability(
  deps: BuiltinReadCapabilityDependencies,
): LearningSystemCapability {
  const capabilityId = "learning-experience";
  const settingsPatchSchema = z
    .object({
      mode: z.enum(["chat", "reading"]).optional(),
      chatAudioEnabled: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.mode !== undefined || value.chatAudioEnabled !== undefined,
      { message: "At least one learning view setting is required" },
    );

  const readPreferences = async (subject: { userId: string }) => {
    const settings = await getUserSettingsForUser(subject.userId);
    return envelope({
      ownerCapabilityId: capabilityId,
      authority: "learner_declared_context",
      scope: { userId: subject.userId },
      asOf: iso(settings?.updatedAt),
      data: {
        learningViewMode:
          settings?.learningViewMode === "reading" ? "reading" : "chat",
        chatAudioEnabled: settings?.chatAudioEnabled ?? false,
      } as const,
    });
  };

  const preferencesTool: CapabilityQueryTool<
    Record<string, never>,
    z.infer<typeof preferencesResultSchema>
  > = {
    key: BUILTIN_READ_QUERY_TOOL_KEYS.getLearningPreferences,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description:
      "Read the learner's effective presentation preferences without exposing provider or secret settings.",
    inputSchema: z.object({}).strict(),
    resultSchema: preferencesResultSchema,
    requiredScopes: ["user"],
    authority: "learner_declared_context",
    maxResultTokens: 100,
    query: async (subject, _input, signal) => {
      abortIfNeeded(signal);
      return readPreferences(subject);
    },
  };
  const settingsPort: CapabilitySettingsPort<
    { mode: "chat" | "reading"; chatAudioEnabled: boolean },
    z.infer<typeof settingsPatchSchema>
  > = {
    capabilityId,
    scope: "user",
    read: async (subject) => {
      if (!subject.userId) throw new Error("Missing user identity");
      const result = await readPreferences({ userId: subject.userId });
      return {
        mode: result.data.learningViewMode,
        chatAudioEnabled: result.data.chatAudioEnabled,
      };
    },
    validatePatch: (input) => settingsPatchSchema.parse(input),
    patch: async (subject, patch) => {
      if (!subject.userId) throw new Error("Missing user identity");
      const settingsPatch = {
        ...(patch.mode !== undefined ? { learningViewMode: patch.mode } : {}),
        ...(patch.chatAudioEnabled !== undefined
          ? { chatAudioEnabled: patch.chatAudioEnabled }
          : {}),
      };
      await deps.upsertUserSettingsForUser(subject.userId, {
        create: settingsPatch,
        update: settingsPatch,
      });
      const result = await readPreferences({ userId: subject.userId });
      return {
        mode: result.data.learningViewMode,
        chatAudioEnabled: result.data.chatAudioEnabled,
      };
    },
  };

  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "learning_system",
      providesQueryTools: [preferencesTool.key],
      settingsScopes: ["user"],
    },
    getQueryTools: () => [preferencesTool] as unknown as CapabilityQueryTool[],
    getSettingsPorts: () =>
      [settingsPort] as unknown as CapabilitySettingsPort[],
  };
}
