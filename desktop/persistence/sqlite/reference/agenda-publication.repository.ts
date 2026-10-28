import type { EntityManager } from "@mikro-orm/core";
import type {
  AgendaPublicationRepository,
  PublishAgendaRevisionInput,
} from "@xue-learn/core/domain";

function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmAgendaPublicationRepository implements AgendaPublicationRepository {
  constructor(private readonly em: EntityManager) {}

  async publish(input: PublishAgendaRevisionInput): Promise<void> {
    await this.em.transactional(async (tx) => {
      const connection = tx.getConnection();
      const execute = (sql: string, params: unknown[] = []) =>
        connection.execute(sql, params, undefined, tx.getTransactionContext());
      const now = input.activatedAt;
      await execute(
        `UPDATE ${table(tx, "AgendaRevision")} SET "status" = 'superseded'
          WHERE "userId" = ? AND "planningDate" = ? AND "status" = 'active'`,
        [input.userId, input.planningDate],
      );
      await execute(
        `INSERT INTO ${table(tx, "AgendaRevision")}
          ("id", "userId", "planningDate", "timezone", "capacityMinutes",
           "capacityJson", "status", "reason", "generationSource",
           "contentHash", "createdAt", "activatedAt")
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
        [
          input.revisionId,
          input.userId,
          input.planningDate,
          input.timezone,
          input.capacityMinutes,
          input.capacityJson,
          input.reason,
          input.generationSource,
          input.contentHash,
          now,
          now,
        ],
      );
      for (const item of input.items) {
        await execute(
          `INSERT INTO ${table(tx, "AgendaItem")}
            ("id", "revisionId", "goalId", "unitId", "sectionId", "itemType",
             "plannedDate", "estimatedMinutes", "priority", "explanation",
             "explanationCode", "completedAt", "reviewDueAt", "reviewCardId",
             "cognitiveEntityIds", "targetState", "expectedEvidence", "sortIndex")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            input.revisionId,
            item.goalId,
            item.unitId,
            item.sectionId,
            item.itemType,
            item.plannedDate,
            item.estimatedMinutes,
            item.priority,
            item.explanation,
            item.explanationCode,
            item.reviewDueAt,
            item.reviewCardId,
            item.cognitiveEntityIdsJson,
            item.targetStateJson,
            item.expectedEvidenceJson,
            item.sortIndex,
          ],
        );
      }
      await execute(
        `INSERT INTO ${table(tx, "LearnerPlanningSettings")}
          ("userId", "agendaInvalidatedAt", "updatedAt") VALUES (?, NULL, ?)
         ON CONFLICT ("userId") DO UPDATE SET
           "agendaInvalidatedAt" = NULL, "updatedAt" = excluded."updatedAt"`,
        [input.userId, now],
      );
    });
  }
}
