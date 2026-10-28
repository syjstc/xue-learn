import { EntitySchema } from "@mikro-orm/core";
import { UserEntity } from "./user.entity.ts";

/** Final v2 `TeachingPersona` storage; legacy archetype columns are retired. */
export class TeachingPersonaEntity {
  user!: UserEntity | string;
  id!: string;
  name!: string;
  avatarCode!: string;
  tagline = "";
  learnerAddress = "你";
  instructionsJson!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export const TeachingPersonaSchema = new EntitySchema<TeachingPersonaEntity>({
  class: TeachingPersonaEntity,
  name: "TeachingPersona",
  tableName: "TeachingPersona",
  properties: {
    user: {
      kind: "m:1",
      entity: () => UserEntity,
      fieldName: "userId",
      mapToPk: true,
      deleteRule: "cascade",
      updateRule: "cascade",
      foreignKeyName: "TeachingPersona_userId_fkey",
    },
    id: {
      type: String,
      columnType: "text",
      primary: true,
      fieldName: "id",
    },
    name: { type: String, columnType: "text", fieldName: "name" },
    avatarCode: {
      type: String,
      columnType: "text",
      fieldName: "avatarCode",
    },
    tagline: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "tagline",
    },
    learnerAddress: {
      type: String,
      columnType: "text",
      default: "你",
      fieldName: "learnerAddress",
    },
    instructionsJson: {
      type: String,
      columnType: "text",
      fieldName: "instructionsJson",
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
  indexes: [
    {
      name: "TeachingPersona_userId_updatedAt_idx",
      properties: ["user", "updatedAt"],
    },
  ],
});
