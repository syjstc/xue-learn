import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  CompleteVerifiedAssessmentInput,
  VerifiedAssessmentCompletionRepository,
  VerifiedAssessmentCompletionResult,
} from "@xue-learn/core/domain";
import { CognitionPersistenceError } from "@xue-learn/core/server/cognition/persistence/error";
import { MikroOrmDomainEventOutboxRepository } from "./domain-event.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";

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

function requiredString(row: Row, key: string): string {
  const value = rowValue(row, key);
  if (typeof value !== "string" || !value) {
    throw new CognitionPersistenceError(
      "not_found",
      `verified assessment row is missing ${key}`,
    );
  }
  return value;
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

/** Raw adapter for the complete adaptive-assessment write set. */
export class MikroOrmVerifiedAssessmentCompletionRepository implements VerifiedAssessmentCompletionRepository {
  private readonly evidence: MikroOrmVerifiedEvidenceAppendRepository;
  private readonly domainEvents: MikroOrmDomainEventOutboxRepository;

  constructor(private readonly em: EntityManager) {
    this.evidence = new MikroOrmVerifiedEvidenceAppendRepository(em);
    this.domainEvents = new MikroOrmDomainEventOutboxRepository(em);
  }

  private execute(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }

  private async assertAttempt(input: CompleteVerifiedAssessmentInput) {
    const row = resultRows(
      await this.execute(
        `SELECT "userId", "taskId", "status"
           FROM ${qualifiedTable(this.em, "TaskAttempt")}
          WHERE "id" = ?`,
        [input.attemptId],
      ),
    )[0];
    if (!row) {
      throw new CognitionPersistenceError(
        "not_found",
        "task attempt not found",
      );
    }
    if (rowValue(row, "userId") !== input.userId) {
      throw new CognitionPersistenceError(
        "ownership_mismatch",
        "task attempt belongs to a different learner",
      );
    }
    if (rowValue(row, "taskId") !== input.taskId) {
      throw new CognitionPersistenceError(
        "invalid_candidate",
        "task attempt does not belong to the submitted task",
      );
    }
    if (rowValue(row, "status") === "abandoned") {
      throw new CognitionPersistenceError(
        "invalid_candidate",
        "abandoned attempts cannot be completed",
      );
    }
  }

  async complete(
    input: CompleteVerifiedAssessmentInput,
  ): Promise<VerifiedAssessmentCompletionResult> {
    await this.assertAttempt(input);
    const evidence = await this.evidence.recordVerifiedObservation({
      userId: input.userId,
      attemptId: input.attemptId,
      candidate: input.candidate,
      evaluator: input.evaluator,
    });
    await this.execute(
      `UPDATE ${qualifiedTable(this.em, "TaskAttempt")}
          SET "status" = 'evaluated', "completedAt" = ?
        WHERE "id" = ? AND "userId" = ? AND "taskId" = ?`,
      [input.completedAt, input.attemptId, input.userId, input.taskId],
    );
    const attempt = resultRows(
      await this.execute(
        `SELECT "status" FROM ${qualifiedTable(this.em, "TaskAttempt")}
          WHERE "id" = ? AND "userId" = ? AND "taskId" = ?`,
        [input.attemptId, input.userId, input.taskId],
      ),
    )[0];
    if (!attempt || rowValue(attempt, "status") !== "evaluated") {
      throw new Error("Verified assessment attempt was not finalized");
    }
    const domainEvent = await this.domainEvents.append({
      id: randomUUID(),
      type: input.domainEvent.type,
      schemaVersion: input.domainEvent.schemaVersion ?? 1,
      idempotencyKey: input.domainEvent.idempotencyKey,
      userId: input.userId,
      goalId: input.goalId,
      unitId: input.unitId ?? null,
      threadId: null,
      payload: JSON.stringify(input.domainEvent.payload),
      occurredAt: input.completedAt,
    });
    return {
      evidence,
      attemptStatus: "evaluated",
      domainEvent,
      replayed: evidence.replayed,
    };
  }
}
