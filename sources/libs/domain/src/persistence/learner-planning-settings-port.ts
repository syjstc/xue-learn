export type LearnerPlanningSettingsRecord = Readonly<{
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
}>;

export type LearnerPlanningSettingsPatch = Readonly<
  Partial<Omit<LearnerPlanningSettingsRecord, "userId" | "updatedAt">>
>;

export type UpsertLearnerPlanningSettingsInput = Readonly<{
  userId: string;
  patch?: LearnerPlanningSettingsPatch;
}>;

/** Capability-specific persistence for the learner's agenda preferences. */
export interface LearnerPlanningSettingsRepository {
  findByUserId(userId: string): Promise<LearnerPlanningSettingsRecord | null>;
  upsert(
    input: UpsertLearnerPlanningSettingsInput,
  ): Promise<LearnerPlanningSettingsRecord>;
}
