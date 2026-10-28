import { EntitySchema } from "@mikro-orm/core";

/** Legacy hosted event queue row; delivery state migrates in a later jobs slice. */
export class EventOutboxEntity {
  id!: string;
  type!: string;
  payload!: string;
  createdAt!: Date;
  publishedAt: Date | null = null;
  attemptCount = 0;
  nextAttemptAt: Date | null = null;
  lastError: string | null = null;
  deadLetteredAt: Date | null = null;
}

export const EventOutboxSchema = new EntitySchema<EventOutboxEntity>({
  class: EventOutboxEntity,
  name: "EventOutbox",
  tableName: "EventOutbox",
  properties: {
    id: {
      type: String,
      columnType: "text",
      primary: true,
      fieldName: "id",
    },
    type: { type: String, columnType: "text", fieldName: "type" },
    payload: { type: String, columnType: "text", fieldName: "payload" },
    createdAt: {
      type: Date,
      columnType: "timestamp(3)",
      defaultRaw: "CURRENT_TIMESTAMP",
      fieldName: "createdAt",
      onCreate: () => new Date(),
    },
    publishedAt: {
      type: Date,
      columnType: "timestamp(3)",
      nullable: true,
      fieldName: "publishedAt",
    },
    attemptCount: {
      type: Number,
      columnType: "integer",
      default: 0,
      fieldName: "attemptCount",
    },
    nextAttemptAt: {
      type: Date,
      columnType: "timestamp(3)",
      nullable: true,
      defaultRaw: "CURRENT_TIMESTAMP",
      fieldName: "nextAttemptAt",
    },
    lastError: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "lastError",
    },
    deadLetteredAt: {
      type: Date,
      columnType: "timestamp(3)",
      nullable: true,
      fieldName: "deadLetteredAt",
    },
  },
  indexes: [
    { name: "EventOutbox_publishedAt_idx", properties: ["publishedAt"] },
    {
      name: "EventOutbox_publishedAt_deadLetteredAt_nextAttemptAt_idx",
      properties: ["publishedAt", "deadLetteredAt", "nextAttemptAt"],
    },
  ],
});
