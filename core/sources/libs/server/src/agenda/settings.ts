import type {
  LearnerPlanningSettingsPatch,
  LearnerPlanningSettingsRepository,
} from "../../../domain/src/index.js";
import {
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  DEFAULT_TIMEZONE,
} from "./types.js";
import { isValidTimeZone } from "./timezone.js";

let configuredPlanningSettings: LearnerPlanningSettingsRepository | undefined;

function persistence(): LearnerPlanningSettingsRepository {
  if (!configuredPlanningSettings)
    throw new Error("Agenda planning-settings persistence is not configured");
  return configuredPlanningSettings;
}

export function configureAgendaPlanningSettingsPersistence(
  repository: LearnerPlanningSettingsRepository | undefined,
): void {
  configuredPlanningSettings = repository;
}

export type PlanningSettings = {
  userId: string;
  enabled: boolean;
  timezone: string;
  reminderEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
  dailyCapacityTargetMin: number;
  todayCapacityOverrideMin: number | null;
  todayCapacityOverrideDate: string | null;
  goalPriorities: Record<string, number>;
  agendaInvalidatedAt: string | null;
  updatedAt: string;
};

function parsePriorities(raw: string): Record<string, number> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = Math.max(0, Math.min(100, Math.round(value)));
      }
    }
    return out;
  } catch {
    return {};
  }
}

function toSettings(row: {
  userId: string;
  enabled: boolean;
  timezone: string;
  reminderEnabled: boolean;
  reminderHour: number;
  reminderMinute: number;
  dailyCapacityTargetMin: number;
  todayCapacityOverrideMin: number | null;
  todayCapacityOverrideDate: string | null;
  goalPrioritiesJson: string;
  agendaInvalidatedAt: Date | null;
  updatedAt: Date;
}): PlanningSettings {
  return {
    userId: row.userId,
    enabled: row.enabled,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    reminderEnabled: row.reminderEnabled,
    reminderHour: row.reminderHour,
    reminderMinute: row.reminderMinute,
    dailyCapacityTargetMin: row.dailyCapacityTargetMin,
    todayCapacityOverrideMin: row.todayCapacityOverrideMin,
    todayCapacityOverrideDate: row.todayCapacityOverrideDate,
    goalPriorities: parsePriorities(row.goalPrioritiesJson),
    agendaInvalidatedAt: row.agendaInvalidatedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrCreatePlanningSettings(
  userId: string,
  _compatibilityClient?: unknown,
): Promise<PlanningSettings> {
  const repository = persistence();
  const existing = await repository.findByUserId(userId);
  if (existing) return toSettings(existing);
  return toSettings(
    await repository.upsert({
      userId,
      patch: {
        timezone: DEFAULT_TIMEZONE,
        reminderHour: DEFAULT_REMINDER_HOUR,
        reminderMinute: DEFAULT_REMINDER_MINUTE,
      },
    }),
  );
}

export type PatchPlanningSettingsInput = {
  enabled?: boolean;
  timezone?: string;
  reminderEnabled?: boolean;
  reminderHour?: number;
  reminderMinute?: number;
  dailyCapacityTargetMin?: number;
  todayCapacityOverrideMin?: number | null;
  todayCapacityOverrideDate?: string | null;
  goalPriorities?: Record<string, number>;
};

export async function patchPlanningSettings(
  userId: string,
  patch: PatchPlanningSettingsInput,
  compatibilityClient?: unknown,
): Promise<PlanningSettings> {
  await getOrCreatePlanningSettings(userId, compatibilityClient);
  const data: Record<string, unknown> = {
    agendaInvalidatedAt: new Date(),
  };
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.timezone !== undefined) {
    data.timezone = isValidTimeZone(patch.timezone)
      ? patch.timezone
      : DEFAULT_TIMEZONE;
  }
  if (patch.reminderEnabled !== undefined) {
    data.reminderEnabled = patch.reminderEnabled;
  }
  if (patch.reminderHour !== undefined) {
    data.reminderHour = Math.max(
      0,
      Math.min(23, Math.round(patch.reminderHour)),
    );
  }
  if (patch.reminderMinute !== undefined) {
    data.reminderMinute = Math.max(
      0,
      Math.min(59, Math.round(patch.reminderMinute)),
    );
  }
  if (patch.dailyCapacityTargetMin !== undefined) {
    data.dailyCapacityTargetMin = Math.max(
      15,
      Math.min(180, Math.round(patch.dailyCapacityTargetMin)),
    );
  }
  if (patch.todayCapacityOverrideMin !== undefined) {
    data.todayCapacityOverrideMin =
      patch.todayCapacityOverrideMin == null
        ? null
        : Math.max(
            15,
            Math.min(180, Math.round(patch.todayCapacityOverrideMin)),
          );
  }
  if (patch.todayCapacityOverrideDate !== undefined) {
    data.todayCapacityOverrideDate = patch.todayCapacityOverrideDate;
  }
  if (patch.goalPriorities !== undefined) {
    const cleaned: Record<string, number> = {};
    for (const [key, value] of Object.entries(patch.goalPriorities)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        cleaned[key] = Math.max(0, Math.min(100, Math.round(value)));
      }
    }
    data.goalPrioritiesJson = JSON.stringify(cleaned);
  }
  return toSettings(
    await persistence().upsert({
      userId,
      patch: data as LearnerPlanningSettingsPatch,
    }),
  );
}

export async function invalidateAgendaForUser(
  userId: string,
  _compatibilityClient?: unknown,
): Promise<void> {
  await persistence().upsert({
    userId,
    patch: { agendaInvalidatedAt: new Date() },
  });
}
