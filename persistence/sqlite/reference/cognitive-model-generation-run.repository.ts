import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  AppendCognitiveModelRunEventInput,
  CognitiveModelGenerationRunRepository,
  CognitiveModelRunEventRecord,
  CognitiveModelRunRecord,
  FinishCognitiveModelRunInput,
  FindCognitiveModelRunInput,
  ReadCognitiveModelRunEventInput,
  StartCognitiveModelRunInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";

type Row = Readonly<Record<string, unknown>>;

function resultRows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }
  return [];
}

function rowValue(row: Row, key: string): unknown {
  return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

const OPERATION = "unit.cognitive_model";

/** Transaction-neutral run/event adapter; the runtime owns the unit of work. */
export class MikroOrmCognitiveModelGenerationRunRepository implements CognitiveModelGenerationRunRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }

  async start(
    input: StartCognitiveModelRunInput,
  ): Promise<CognitiveModelRunRecord> {
    const runTable = qualifiedTable(this.em, "AiGenerationRun");
    const now = new Date();
    await this.execute(
      `UPDATE ${runTable}
          SET "status" = 'error',
              "errorMessage" = ?,
              "updatedAt" = ?
        WHERE "scope" = 'unit'
          AND "scopeId" = ?
          AND "operation" = ?
          AND "status" = 'running'`,
      [
        "Superseded by a new cognitive-model build",
        now,
        input.unitId,
        OPERATION,
      ],
    );
    const id = randomUUID();
    await this.execute(
      `INSERT INTO ${runTable}
        ("id", "userId", "scope", "scopeId", "operation", "status", "statusMessage", "createdAt", "updatedAt")
       VALUES (?, ?, 'unit', ?, ?, 'running', ?, ?, ?)`,
      [
        id,
        input.userId,
        input.unitId,
        OPERATION,
        input.statusMessage,
        now,
        now,
      ],
    );
    return { id, status: "running" };
  }

  async findLatest(
    input: FindCognitiveModelRunInput,
  ): Promise<CognitiveModelRunRecord | null> {
    if (input.statuses.length === 0) return null;
    const runTable = qualifiedTable(this.em, "AiGenerationRun");
    const row = resultRows(
      await this.execute(
        `SELECT "id", "status"
           FROM ${runTable}
          WHERE "scope" = 'unit'
            AND "scopeId" = ?
            AND "operation" = ?
            AND "status" IN (${input.statuses.map(() => "?").join(", ")})
          ORDER BY "createdAt" DESC
          LIMIT 1`,
        [input.unitId, OPERATION, ...input.statuses],
      ),
    )[0];
    if (!row) return null;
    return {
      id: String(rowValue(row, "id")),
      status: String(
        rowValue(row, "status"),
      ) as CognitiveModelRunRecord["status"],
    };
  }

  async readLatestEvent(
    input: ReadCognitiveModelRunEventInput,
  ): Promise<CognitiveModelRunEventRecord | null> {
    const eventTable = qualifiedTable(this.em, "AiGenerationRunEvent");
    const row = resultRows(
      await this.execute(
        `SELECT "payload"
           FROM ${eventTable}
          WHERE "runId" = ? AND "type" = ?
          ORDER BY "sequence" DESC
          LIMIT 1`,
        [input.runId, input.type],
      ),
    )[0];
    return row ? { payloadJson: String(rowValue(row, "payload")) } : null;
  }

  async appendEvent(
    input: AppendCognitiveModelRunEventInput,
  ): Promise<boolean> {
    const runTable = qualifiedTable(this.em, "AiGenerationRun");
    const eventTable = qualifiedTable(this.em, "AiGenerationRunEvent");
    const now = new Date();
    const updated = resultRows(
      await this.execute(
        `UPDATE ${runTable}
            SET "nextEventSequence" = "nextEventSequence" + 1,
                "updatedAt" = ?
          WHERE "id" = ? AND "status" = 'running'
          RETURNING "nextEventSequence"`,
        [now, input.runId],
      ),
    )[0];
    if (!updated) return false;
    const sequence = Number(rowValue(updated, "nextEventSequence"));
    const id = randomUUID();
    if (input.snapshotKey) {
      await this.execute(
        `INSERT INTO ${eventTable}
          ("id", "runId", "sequence", "type", "payload", "snapshotKey", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT ("runId", "snapshotKey") DO UPDATE SET
           "sequence" = excluded."sequence",
           "type" = excluded."type",
           "payload" = excluded."payload",
           "createdAt" = excluded."createdAt"`,
        [
          id,
          input.runId,
          sequence,
          input.type,
          input.payloadJson,
          input.snapshotKey,
          now,
        ],
      );
    } else {
      await this.execute(
        `INSERT INTO ${eventTable}
          ("id", "runId", "sequence", "type", "payload", "createdAt")
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.runId, sequence, input.type, input.payloadJson, now],
      );
    }
    return true;
  }

  async finish(input: FinishCognitiveModelRunInput): Promise<boolean> {
    const runTable = qualifiedTable(this.em, "AiGenerationRun");
    const now = new Date();
    const result =
      input.status === "completed"
        ? await this.execute(
            `UPDATE ${runTable}
                SET "status" = 'completed',
                    "resultJson" = ?,
                    "statusMessage" = '',
                    "updatedAt" = ?
              WHERE "id" = ? AND "status" = 'running'
              RETURNING "id"`,
            [input.resultJson ?? "{}", now, input.runId],
          )
        : await this.execute(
            `UPDATE ${runTable}
                SET "status" = 'error',
                    "errorMessage" = ?,
                    "updatedAt" = ?
              WHERE "id" = ? AND "status" = 'running'
              RETURNING "id"`,
            [input.resultJson ?? "", now, input.runId],
          );
    return resultRows(result).length > 0;
  }
}
