import { EntitySchema } from "@mikro-orm/core";
import { LearningGoalEntity } from "./learning-goal.entity.ts";
import { LearningSpaceEntity } from "./learning-space.entity.ts";

/** Goal membership or planned-goal placeholder within a roadmap space. */
export class LearningSpaceItemEntity {
  space!: LearningSpaceEntity | string;
  goal!: LearningGoalEntity | string | null;
  id!: string;
  itemType = "goal";
  plannedTitle = "";
  rationale = "";
  suggestedGoalKind = "full";
  goalBriefJson = "{}";
  source = "manual";
  sortIndex = 0;
  createdAt!: Date;
  updatedAt!: Date;
}

export const LearningSpaceItemSchema =
  new EntitySchema<LearningSpaceItemEntity>({
    class: LearningSpaceItemEntity,
    name: "LearningSpaceItem",
    tableName: "LearningSpaceItem",
    properties: {
      space: {
        kind: "m:1",
        entity: () => LearningSpaceEntity,
        fieldName: "spaceId",
        mapToPk: true,
        deleteRule: "cascade",
        updateRule: "cascade",
        foreignKeyName: "LearningSpaceItem_spaceId_fkey",
      },
      goal: {
        kind: "m:1",
        entity: () => LearningGoalEntity,
        fieldName: "goalId",
        mapToPk: true,
        nullable: true,
        deleteRule: "cascade",
        updateRule: "cascade",
        foreignKeyName: "LearningSpaceItem_goalId_fkey",
      },
      id: {
        type: String,
        columnType: "text",
        primary: true,
        fieldName: "id",
      },
      itemType: {
        type: String,
        columnType: "text",
        default: "goal",
        fieldName: "itemType",
      },
      plannedTitle: {
        type: String,
        columnType: "text",
        default: "",
        fieldName: "plannedTitle",
      },
      rationale: {
        type: String,
        columnType: "text",
        default: "",
        fieldName: "rationale",
      },
      suggestedGoalKind: {
        type: String,
        columnType: "text",
        default: "full",
        fieldName: "suggestedGoalKind",
      },
      goalBriefJson: {
        type: String,
        columnType: "text",
        default: "{}",
        fieldName: "goalBriefJson",
      },
      source: {
        type: String,
        columnType: "text",
        default: "manual",
        fieldName: "source",
      },
      sortIndex: {
        type: Number,
        columnType: "integer",
        default: 0,
        fieldName: "sortIndex",
      },
      createdAt: {
        type: Date,
        columnType: "timestamp(3)",
        defaultRaw: "CURRENT_TIMESTAMP",
        fieldName: "createdAt",
        onCreate: () => new Date(),
      },
      updatedAt: {
        type: Date,
        columnType: "timestamp(3)",
        fieldName: "updatedAt",
        onCreate: () => new Date(),
        onUpdate: () => new Date(),
      },
    },
    uniques: [{ name: "LearningSpaceItem_goalId_key", properties: ["goal"] }],
    indexes: [
      {
        name: "LearningSpaceItem_spaceId_sortIndex_idx",
        properties: ["space", "sortIndex"],
      },
    ],
    checks: [
      {
        name: "LearningSpaceItem_shape_check",
        expression:
          '"itemType" = \'goal\' AND "goalId" IS NOT NULL OR "itemType" = \'planned_goal\' AND "goalId" IS NULL AND length(trim("plannedTitle")) > 0',
      },
    ],
  });
