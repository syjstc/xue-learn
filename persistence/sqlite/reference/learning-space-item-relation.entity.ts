import { EntitySchema } from "@mikro-orm/core";
import { LearningSpaceEntity } from "./learning-space.entity.ts";
import { LearningSpaceItemEntity } from "./learning-space-item.entity.ts";

/** Explicit directed relation between two items in a roadmap space. */
export class LearningSpaceItemRelationEntity {
  space!: LearningSpaceEntity | string;
  fromItem!: LearningSpaceItemEntity | string;
  toItem!: LearningSpaceItemEntity | string;
  id!: string;
  relationType!: string;
  source = "manual";
  createdAt!: Date;
}

export const LearningSpaceItemRelationSchema =
  new EntitySchema<LearningSpaceItemRelationEntity>({
    class: LearningSpaceItemRelationEntity,
    name: "LearningSpaceItemRelation",
    tableName: "LearningSpaceItemRelation",
    properties: {
      space: {
        kind: "m:1",
        entity: () => LearningSpaceEntity,
        fieldName: "spaceId",
        mapToPk: true,
        deleteRule: "cascade",
        updateRule: "cascade",
        foreignKeyName: "LearningSpaceItemRelation_spaceId_fkey",
      },
      fromItem: {
        kind: "m:1",
        entity: () => LearningSpaceItemEntity,
        fieldName: "fromItemId",
        mapToPk: true,
        deleteRule: "cascade",
        updateRule: "cascade",
        foreignKeyName: "LearningSpaceItemRelation_fromItemId_fkey",
      },
      toItem: {
        kind: "m:1",
        entity: () => LearningSpaceItemEntity,
        fieldName: "toItemId",
        mapToPk: true,
        deleteRule: "cascade",
        updateRule: "cascade",
        foreignKeyName: "LearningSpaceItemRelation_toItemId_fkey",
      },
      id: {
        type: String,
        columnType: "text",
        primary: true,
        fieldName: "id",
      },
      relationType: {
        type: String,
        columnType: "text",
        fieldName: "relationType",
      },
      source: {
        type: String,
        columnType: "text",
        default: "manual",
        fieldName: "source",
      },
      createdAt: {
        type: Date,
        columnType: "timestamp(3)",
        defaultRaw: "CURRENT_TIMESTAMP",
        fieldName: "createdAt",
        onCreate: () => new Date(),
      },
    },
    uniques: [
      {
        name: "LearningSpaceItemRelation_fromItemId_toItemId_relationType_key",
        properties: ["fromItem", "toItem", "relationType"],
      },
    ],
    indexes: [
      { name: "LearningSpaceItemRelation_spaceId_idx", properties: ["space"] },
      {
        name: "LearningSpaceItemRelation_toItemId_idx",
        properties: ["toItem"],
      },
    ],
    checks: [
      {
        name: "LearningSpaceItemRelation_no_self_check",
        expression: '"fromItemId" <> "toItemId"',
      },
      {
        name: "LearningSpaceItemRelation_type_check",
        expression:
          "\"relationType\" IN ('prerequisite', 'supports', 'follow_up', 'related')",
      },
    ],
  });
