import { EntitySchema } from "@mikro-orm/core";

/**
 * ORM representation of the existing `LearningProfile` table.
 *
 * The class deliberately has no decorators.  EntitySchema keeps metadata
 * explicit and works the same way with MikroORM's PostgreSQL and SQLite SQL
 * drivers, including when the server is loaded from a CommonJS bundle.
 */
export class LearnerProfileEntity {
  userId!: string;
  profileJson = "{}";
  updatedAt!: Date;
}

/**
 * Shared metadata for the web PostgreSQL database and the local SQLite
 * database.  Field names are explicit because the hosted Persistence schema uses
 * quoted PascalCase table/column names and the local database must preserve
 * the same logical shape.
 */
export const LearnerProfileSchema = new EntitySchema<LearnerProfileEntity>({
  class: LearnerProfileEntity,
  name: "LearningProfile",
  tableName: "LearningProfile",
  properties: {
    userId: {
      type: String,
      columnType: "text",
      primary: true,
      fieldName: "userId",
    },
    profileJson: {
      type: String,
      columnType: "text",
      fieldName: "profileJson",
      default: "{}",
    },
    updatedAt: {
      type: Date,
      columnType: "timestamp(3)",
      fieldName: "updatedAt",
      onCreate: () => new Date(),
      onUpdate: () => new Date(),
    },
  },
});
