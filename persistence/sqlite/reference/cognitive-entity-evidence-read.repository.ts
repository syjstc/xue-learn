import type { EntityManager } from "@mikro-orm/core";
import type {
  CognitiveEntityEvidenceReadRecord,
  CognitiveEntityEvidenceReadRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import {
  claimToDto,
  type ClaimForDto,
} from "@xue-learn/core/source/libs/server/src/cognition/persistence/state.ts";
import { CognitionPersistenceError } from "@xue-learn/core/source/libs/server/src/cognition/persistence/error.ts";
import { referenceDateValue } from "./date-value.ts";

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
  if (typeof value !== "string" || value.length === 0) {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      `cognitive entity evidence row is missing ${key}`,
    );
  }
  return value;
}

function dateValue(value: unknown, label: string): Date {
  try {
    return referenceDateValue(value, label);
  } catch {
    throw new CognitionPersistenceError(
      "invalid_declaration",
      `cognitive entity evidence row has invalid ${label}`,
    );
  }
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function qualifiedTable(em: EntityManager, table: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

type LifecycleRow = Readonly<{
  id: string;
  eventType: string;
  reason: string;
  createdAt: Date;
}>;

function toLifecycleRow(row: Row): LifecycleRow {
  return {
    id: requiredString(row, "id"),
    eventType: requiredString(row, "eventType"),
    reason:
      typeof rowValue(row, "reason") === "string"
        ? (rowValue(row, "reason") as string)
        : "",
    createdAt: dateValue(rowValue(row, "createdAt"), "lifecycle createdAt"),
  };
}

function toClaim(
  row: Row,
  lifecycleEvents: readonly LifecycleRow[],
): ClaimForDto {
  const entityId = requiredString(row, "cognitiveEntityId");
  const attemptId = requiredString(row, "attemptId");
  const taskId = requiredString(row, "taskId");
  return {
    id: requiredString(row, "id"),
    userId: requiredString(row, "userId"),
    cognitiveEntityId: entityId,
    dimension: requiredString(row, "dimension"),
    criterionRef: requiredString(row, "criterionRef"),
    score: Number(rowValue(row, "score")),
    strength: Number(rowValue(row, "strength")),
    evaluatorReliability: Number(rowValue(row, "evaluatorReliability")),
    groundingReliability: Number(rowValue(row, "groundingReliability")),
    definitionVersion: Number(rowValue(row, "definitionVersion")),
    contextKey: requiredString(row, "contextKey"),
    status: requiredString(row, "status"),
    validFrom: dateValue(rowValue(row, "validFrom"), "validFrom"),
    validUntil:
      rowValue(row, "validUntil") == null
        ? null
        : dateValue(rowValue(row, "validUntil"), "validUntil"),
    createdAt: dateValue(rowValue(row, "createdAt"), "createdAt"),
    cognitiveEntity: {
      kind: requiredString(row, "entityKind"),
    },
    observation: {
      metadata: decodeJson(rowValue(row, "metadata")),
      evaluatorType: requiredString(row, "evaluatorType"),
      observedAt: dateValue(rowValue(row, "observedAt"), "observedAt"),
      attemptId,
      attempt: {
        taskId,
        durationMs:
          rowValue(row, "durationMs") == null
            ? null
            : Number(rowValue(row, "durationMs")),
        artifactRefs: decodeJson(rowValue(row, "artifactRefs")),
        task: {
          title: requiredString(row, "taskTitle"),
          context: decodeJson(rowValue(row, "taskContext")),
        },
      },
    },
    lifecycleEvents: lifecycleEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      reason: event.reason,
      createdAt: event.createdAt,
    })),
  } as unknown as ClaimForDto;
}

/** PostgreSQL/SQLite raw-SQL implementation of learner-owned evidence audit reads. */
export class MikroOrmCognitiveEntityEvidenceReadRepository implements CognitiveEntityEvidenceReadRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  async findForEntity(input: {
    userId: string;
    cognitiveEntityId: string;
  }): Promise<CognitiveEntityEvidenceReadRecord | null> {
    const entityRows = resultRows(
      await this.execute(
        `SELECT ce."scope", ce."ownerUserId", g."userId" AS "goalUserId"
           FROM ${qualifiedTable(this.em, "CognitiveEntity")} ce
           LEFT JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = ce."goalId"
          WHERE ce."id" = ?`,
        [input.cognitiveEntityId],
      ),
    );
    const entity = entityRows[0];
    if (
      !entity ||
      !(
        rowValue(entity, "scope") === "system" ||
        rowValue(entity, "ownerUserId") === input.userId ||
        rowValue(entity, "goalUserId") === input.userId
      )
    ) {
      return null;
    }

    const claimRows = resultRows(
      await this.execute(
        `SELECT c."id", c."userId", c."cognitiveEntityId", c."dimension",
                c."criterionRef", c."score", c."strength",
                c."evaluatorReliability", c."groundingReliability",
                c."definitionVersion", c."contextKey", c."status",
                c."validFrom", c."validUntil", c."createdAt",
                ce."kind" AS "entityKind",
                o."metadata", o."evaluatorType", o."observedAt", o."attemptId",
                a."taskId", a."durationMs", a."artifactRefs",
                t."title" AS "taskTitle", t."context" AS "taskContext"
           FROM ${qualifiedTable(this.em, "EvidenceClaim")} c
           JOIN ${qualifiedTable(this.em, "CognitiveEntity")} ce
             ON ce."id" = c."cognitiveEntityId"
           JOIN ${qualifiedTable(this.em, "TaskObservation")} o
             ON o."id" = c."observationId"
           JOIN ${qualifiedTable(this.em, "TaskAttempt")} a
             ON a."id" = o."attemptId"
           JOIN ${qualifiedTable(this.em, "LearningTask")} t
             ON t."id" = a."taskId"
          WHERE c."userId" = ? AND c."cognitiveEntityId" = ?
          ORDER BY c."createdAt" DESC, c."id" DESC`,
        [input.userId, input.cognitiveEntityId],
      ),
    );
    if (claimRows.length === 0) return { claims: [] };

    const claimIds = claimRows.map((row) => requiredString(row, "id"));
    const placeholders = claimIds.map(() => "?").join(", ");
    const lifecycleRows = resultRows(
      await this.execute(
        `SELECT "id", "evidenceClaimId", "eventType", "reason", "createdAt"
           FROM ${qualifiedTable(this.em, "EvidenceLifecycleEvent")}
          WHERE "evidenceClaimId" IN (${placeholders})
          ORDER BY "createdAt" ASC, "id" ASC`,
        claimIds,
      ),
    );
    const lifecycleByClaim = new Map<string, LifecycleRow[]>();
    for (const row of lifecycleRows) {
      const claimId = requiredString(row, "evidenceClaimId");
      const events = lifecycleByClaim.get(claimId) ?? [];
      events.push(toLifecycleRow(row));
      lifecycleByClaim.set(claimId, events);
    }
    return {
      claims: claimRows.map((row) =>
        claimToDto(
          toClaim(row, lifecycleByClaim.get(requiredString(row, "id")) ?? []),
        ),
      ),
    };
  }
}
