import { EntitySchema } from "@mikro-orm/core";
import { UserEntity } from "./user.entity.ts";

/** Final agenda-owned planning settings after the capacity migration. */
export class LearnerPlanningSettingsEntity {
  user!: UserEntity | string;
  enabled = true;
  timezone = "Asia/Shanghai";
  reminderEnabled = true;
  reminderHour = 19;
  reminderMinute = 0;
  dailyCapacityTargetMin = 30;
  todayCapacityOverrideMin: number | null = null;
  todayCapacityOverrideDate: string | null = null;
  goalPrioritiesJson = "{}";
  agendaInvalidatedAt: Date | null = null;
  updatedAt!: Date;
}

export const LearnerPlanningSettingsSchema =
  new EntitySchema<LearnerPlanningSettingsEntity>({
    class: LearnerPlanningSettingsEntity,
    name: "LearnerPlanningSettings",
    tableName: "LearnerPlanningSettings",
    properties: {
      user: {
        kind: "m:1",
        entity: () => UserEntity,
        fieldName: "userId",
        primary: true,
        mapToPk: true,
        deleteRule: "cascade",
        updateRule: "cascade",
        foreignKeyName: "LearnerPlanningSettings_userId_fkey",
      },
      enabled: {
        type: Boolean,
        columnType: "boolean",
        default: true,
        fieldName: "enabled",
      },
      timezone: {
        type: String,
        columnType: "text",
        default: "Asia/Shanghai",
        fieldName: "timezone",
      },
      reminderEnabled: {
        type: Boolean,
        columnType: "boolean",
        default: true,
        fieldName: "reminderEnabled",
      },
      reminderHour: {
        type: Number,
        columnType: "integer",
        default: 19,
        fieldName: "reminderHour",
      },
      reminderMinute: {
        type: Number,
        columnType: "integer",
        default: 0,
        fieldName: "reminderMinute",
      },
      dailyCapacityTargetMin: {
        type: Number,
        columnType: "integer",
        default: 30,
        fieldName: "dailyCapacityTargetMin",
      },
      todayCapacityOverrideMin: {
        type: Number,
        columnType: "integer",
        nullable: true,
        fieldName: "todayCapacityOverrideMin",
      },
      todayCapacityOverrideDate: {
        type: String,
        columnType: "text",
        nullable: true,
        fieldName: "todayCapacityOverrideDate",
      },
      goalPrioritiesJson: {
        type: String,
        columnType: "text",
        default: "{}",
        fieldName: "goalPrioritiesJson",
      },
      agendaInvalidatedAt: {
        type: Date,
        columnType: "timestamp(3)",
        nullable: true,
        fieldName: "agendaInvalidatedAt",
      },
      updatedAt: {
        type: Date,
        columnType: "timestamp(3)",
        fieldName: "updatedAt",
        onCreate: () => new Date(),
        onUpdate: () => new Date(),
      },
    },
    checks: [
      {
        name: "LearnerPlanningSettings_dailyCapacityTargetMin_check",
        expression:
          '"dailyCapacityTargetMin" >= 15 AND "dailyCapacityTargetMin" <= 180',
      },
      {
        name: "LearnerPlanningSettings_todayCapacityOverrideMin_check",
        expression:
          '"todayCapacityOverrideMin" IS NULL OR ("todayCapacityOverrideMin" >= 15 AND "todayCapacityOverrideMin" <= 180)',
      },
    ],
  });
