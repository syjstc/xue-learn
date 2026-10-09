import { EntitySchema } from "@mikro-orm/core";
import { UserEntity } from "./user.entity.ts";

/** User-owned roadmap organization; goal truth remains outside this entity. */
export class LearningSpaceEntity {
  user!: UserEntity | string;
  id!: string;
  name!: string;
  normalizedName!: string;
  purpose = "";
  sortIndex = 0;
  revision = 1;
  createdAt!: Date;
  updatedAt!: Date;
}

export const LearningSpaceSchema = new EntitySchema<LearningSpaceEntity>({
  class: LearningSpaceEntity,
  name: "LearningSpace",
  tableName: "LearningSpace",
  properties: {
    user: {
      kind: "m:1",
      entity: () => UserEntity,
      fieldName: "userId",
      mapToPk: true,
      deleteRule: "cascade",
      updateRule: "cascade",
      foreignKeyName: "LearningSpace_userId_fkey",
    },
    id: {
      type: String,
      columnType: "text",
      primary: true,
      fieldName: "id",
    },
    name: { type: String, columnType: "text", fieldName: "name" },
    normalizedName: {
      type: String,
      columnType: "text",
      fieldName: "normalizedName",
    },
    purpose: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "purpose",
    },
    sortIndex: {
      type: Number,
      columnType: "integer",
      default: 0,
      fieldName: "sortIndex",
    },
    revision: {
      type: Number,
      columnType: "integer",
      default: 1,
      fieldName: "revision",
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
  uniques: [
    {
      name: "LearningSpace_userId_normalizedName_key",
      properties: ["user", "normalizedName"],
    },
  ],
  indexes: [
    {
      name: "LearningSpace_userId_sortIndex_idx",
      properties: ["user", "sortIndex"],
    },
  ],
});
