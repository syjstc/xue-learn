import type { EntityManager } from "@mikro-orm/core";
import type {
  LearnerPlanningSettingsRecord,
  LearnerPlanningSettingsRepository,
  UpsertLearnerPlanningSettingsInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { LearnerPlanningSettingsEntity } from "./learner-planning-settings.entity.ts";
import { UserEntity } from "./user.entity.ts";

function toRecord(
  entity: LearnerPlanningSettingsEntity,
): LearnerPlanningSettingsRecord {
  return {
    userId: typeof entity.user === "string" ? entity.user : entity.user.id,
    enabled: entity.enabled,
    timezone: entity.timezone,
    reminderEnabled: entity.reminderEnabled,
    reminderHour: entity.reminderHour,
    reminderMinute: entity.reminderMinute,
    dailyCapacityTargetMin: entity.dailyCapacityTargetMin,
    todayCapacityOverrideMin: entity.todayCapacityOverrideMin,
    todayCapacityOverrideDate: entity.todayCapacityOverrideDate,
    goalPrioritiesJson: entity.goalPrioritiesJson,
    agendaInvalidatedAt: entity.agendaInvalidatedAt,
    updatedAt: entity.updatedAt,
  };
}

export class MikroOrmLearnerPlanningSettingsRepository implements LearnerPlanningSettingsRepository {
  constructor(private readonly em: EntityManager) {}

  async findByUserId(
    userId: string,
  ): Promise<LearnerPlanningSettingsRecord | null> {
    const entity = await this.em.findOne(LearnerPlanningSettingsEntity, {
      user: this.em.getReference(UserEntity, userId),
    });
    return entity ? toRecord(entity) : null;
  }

  async upsert(
    input: UpsertLearnerPlanningSettingsInput,
  ): Promise<LearnerPlanningSettingsRecord> {
    const entity = await this.em.upsert(
      LearnerPlanningSettingsEntity,
      {
        user: this.em.getReference(UserEntity, input.userId),
        ...(input.patch ?? {}),
        updatedAt: new Date(),
      },
      { onConflictFields: ["user"] },
    );
    await this.em.flush();
    return toRecord(entity);
  }
}
