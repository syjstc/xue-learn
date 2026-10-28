import { EntitySchema } from "@mikro-orm/core";

export class ModuleStructureDraftEntity {
  moduleId!: string;
  sessionId!: string;
  goalId!: string;
  planHash!: string;
  candidateJson = "{}";
  candidateHash = "";
  status = "queued";
  attemptCount = 0;
  issuesJson = "[]";
  leaseToken: string | null = null;
  leaseUntil: Date | null = null;
  publishedAt: Date | null = null;
  createdAt!: Date;
  updatedAt!: Date;
}

export const ModuleStructureDraftSchema =
  new EntitySchema<ModuleStructureDraftEntity>({
    class: ModuleStructureDraftEntity,
    name: "ModuleStructureDraft",
    tableName: "ModuleStructureDraft",
    properties: {
      moduleId: {
        type: String,
        columnType: "text",
        primary: true,
        fieldName: "moduleId",
      },
      sessionId: { type: String, columnType: "text", fieldName: "sessionId" },
      goalId: { type: String, columnType: "text", fieldName: "goalId" },
      planHash: { type: String, columnType: "text", fieldName: "planHash" },
      candidateJson: {
        type: String,
        columnType: "text",
        fieldName: "candidateJson",
        default: "{}",
      },
      candidateHash: {
        type: String,
        columnType: "text",
        fieldName: "candidateHash",
        default: "",
      },
      status: {
        type: String,
        columnType: "text",
        fieldName: "status",
        default: "queued",
      },
      attemptCount: {
        type: Number,
        columnType: "integer",
        fieldName: "attemptCount",
        default: 0,
      },
      issuesJson: {
        type: String,
        columnType: "text",
        fieldName: "issuesJson",
        default: "[]",
      },
      leaseToken: {
        type: String,
        columnType: "text",
        nullable: true,
        fieldName: "leaseToken",
      },
      leaseUntil: {
        type: Date,
        columnType: "timestamp(3)",
        nullable: true,
        fieldName: "leaseUntil",
      },
      publishedAt: {
        type: Date,
        columnType: "timestamp(3)",
        nullable: true,
        fieldName: "publishedAt",
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
        defaultRaw: "CURRENT_TIMESTAMP",
        fieldName: "updatedAt",
        onCreate: () => new Date(),
        onUpdate: () => new Date(),
      },
    },
    indexes: [
      { name: "ModuleStructureDraft_sessionId_idx", properties: ["sessionId"] },
      { name: "ModuleStructureDraft_goalId_status_idx", properties: ["goalId", "status"] },
    ],
  });
