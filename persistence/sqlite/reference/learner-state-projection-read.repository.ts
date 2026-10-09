import type { EntityManager } from "@mikro-orm/core";
import type {
  LearnerStateDimensionReadRecord,
  LearnerStateProjectionReadRecord,
  LearnerStateProjectionReadRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";

const COGNITIVE_DIMENSIONS = [
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
] as const;

function unobservedLearnerStateProjection(
  cognitiveEntityId: string,
): LearnerStateProjectionReadRecord {
  return {
    cognitiveEntityId,
    overallEstimate: null,
    evidenceSufficiency: 0,
    status: "unobserved",
    inferencePolicyVersion: 1,
    stateRevision: 0,
    evidenceCutoffAt: null,
    lifecycleCutoffAt: null,
    dimensions: COGNITIVE_DIMENSIONS.map((dimension) => ({
      dimension,
      estimate: null,
      evidenceSufficiency: 0,
      evidenceSufficiencyReasons: ["no_evidence"],
      status: "unobserved",
      effectiveEvidenceWeight: 0,
      lastObservedAt: null,
    })),
  };
}

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

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Learner-state projection row is missing ${label}`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Learner-state projection row has invalid ${label}`);
  }
  return parsed;
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function dateValue(value: unknown): Date {
  return referenceDateValue(value, "learner-state projection timestamp");
}

function nullableDate(value: unknown): Date | null {
  return nullableReferenceDateValue(value, "learner-state projection timestamp");
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

/** Raw SQL adapter for owner-scoped learner-state projections. */
export class MikroOrmLearnerStateProjectionReadRepository implements LearnerStateProjectionReadRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }

  async listPromptStates(input: { userId: string; goalId?: string; asOf: Date }) {
    const entityRows = resultRows(
      await this.execute(
        `SELECT DISTINCT ce."id", ce."title", ce."kind"
           FROM ${qualifiedTable(this.em, "CognitiveEntity")} ce
           LEFT JOIN ${qualifiedTable(this.em, "LearningGoal")} g ON g."id" = ce."goalId"
           JOIN ${qualifiedTable(this.em, "LearnerEntityState")} les
             ON les."cognitiveEntityId" = ce."id" AND les."userId" = ?
          WHERE ce."status" = 'active' AND les."lastObservedAt" IS NOT NULL
            AND (ce."scope" = 'system' OR ce."ownerUserId" = ? OR g."userId" = ?)
            AND (? IS NULL OR ce."goalId" = ?)`,
        [input.userId, input.userId, input.userId, input.goalId ?? null, input.goalId ?? null],
      ),
    );
    if (entityRows.length === 0) return [];
    const ids = entityRows.map((row) => stringValue(rowValue(row, "id"), "entity id"));
    const states = await this.findMany({
      userId: input.userId,
      cognitiveEntityIds: ids,
      asOf: input.asOf,
    });
    if (!states) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const evidenceRows = resultRows(
      await this.execute(
        `SELECT ec."cognitiveEntityId", ec."dimension", ec."criterionRef", t."taskType"
           FROM ${qualifiedTable(this.em, "EvidenceClaim")} ec
           JOIN ${qualifiedTable(this.em, "TaskObservation")} o ON o."id" = ec."observationId"
           JOIN ${qualifiedTable(this.em, "TaskAttempt")} a ON a."id" = o."attemptId"
           JOIN ${qualifiedTable(this.em, "LearningTask")} t ON t."id" = a."taskId"
          WHERE ec."userId" = ? AND ec."status" = 'active' AND ec."validFrom" <= ?
            AND ec."cognitiveEntityId" IN (${placeholders})
          ORDER BY ec."createdAt" DESC, ec."id" DESC`,
        [input.userId, input.asOf, ...ids],
      ),
    );
    const latestEvidence = new Map<string, string>();
    for (const row of evidenceRows) {
      const entityId = stringValue(rowValue(row, "cognitiveEntityId"), "evidence entity id");
      if (!latestEvidence.has(entityId)) {
        latestEvidence.set(entityId, `${rowValue(row, "taskType")}/${rowValue(row, "dimension")}/${rowValue(row, "criterionRef")}`);
      }
    }
    const entityById = new Map(entityRows.map((row) => [stringValue(rowValue(row, "id"), "entity id"), row]));
    return states.map((state) => {
      const entity = entityById.get(state.cognitiveEntityId)!;
      return {
        entity: {
          id: state.cognitiveEntityId,
          title: stringValue(rowValue(entity, "title"), "entity title"),
          kind: stringValue(rowValue(entity, "kind"), "entity kind"),
        },
        state,
        latestEvidence: latestEvidence.get(state.cognitiveEntityId) ?? null,
      };
    });
  }

  async findMany(input: {
    userId: string;
    cognitiveEntityIds: readonly string[];
    asOf: Date;
  }): Promise<readonly LearnerStateProjectionReadRecord[] | null> {
    const entityIds = [...new Set(input.cognitiveEntityIds)];
    if (entityIds.length === 0) return [];
    const placeholders = entityIds.map(() => "?").join(", ");
    const entityRows = resultRows(
      await this.execute(
        `SELECT ce."id"
           FROM ${qualifiedTable(this.em, "CognitiveEntity")} ce
           LEFT JOIN ${qualifiedTable(this.em, "LearningGoal")} g
             ON g."id" = ce."goalId"
          WHERE ce."id" IN (${placeholders})
            AND ce."status" = 'active'
            AND (ce."scope" = 'system' OR ce."ownerUserId" = ? OR g."userId" = ?)`,
        [...entityIds, input.userId, input.userId],
      ),
    );
    if (
      new Set(entityRows.map((row) => rowValue(row, "id"))).size !==
      entityIds.length
    ) {
      return null;
    }

    const materializedIds = new Set(
      resultRows(
        await this.execute(
          `SELECT les."cognitiveEntityId"
             FROM ${qualifiedTable(this.em, "LearnerEntityState")} les
            WHERE les."userId" = ? AND les."cognitiveEntityId" IN (${placeholders})`,
          [input.userId, ...entityIds],
        ),
      ).map((row) =>
        stringValue(rowValue(row, "cognitiveEntityId"), "cognitiveEntityId"),
      ),
    );
    const rows = resultRows(
      await this.execute(
        `SELECT les."cognitiveEntityId", les."estimate", les."evidenceSufficiency",
                les."status", les."inferenceVersion", les."updatedAt",
                revision."revision", revision."evidenceCutoffAt",
                revision."lifecycleCutoffAt", lds."dimension", lds."estimate" AS "dimensionEstimate",
                lds."evidenceSufficiency" AS "dimensionEvidenceSufficiency",
                lds."evidenceSufficiencyReasons", lds."status" AS "dimensionStatus",
                lds."evidenceWeight", lds."lastObservedAt", lds."inferenceVersion" AS "dimensionInferenceVersion"
           FROM ${qualifiedTable(this.em, "LearnerEntityState")} les
           JOIN ${qualifiedTable(this.em, "LearnerStateRevision")} revision
             ON revision."userId" = les."userId"
            AND revision."cognitiveEntityId" = les."cognitiveEntityId"
            AND revision."revision" = (
              SELECT MAX(latest."revision")
                FROM ${qualifiedTable(this.em, "LearnerStateRevision")} latest
               WHERE latest."userId" = les."userId"
                 AND latest."cognitiveEntityId" = les."cognitiveEntityId"
            )
           LEFT JOIN ${qualifiedTable(this.em, "LearnerDimensionState")} lds
             ON lds."learnerEntityStateId" = les."id"
          WHERE les."userId" = ? AND les."cognitiveEntityId" IN (${placeholders})
          ORDER BY les."cognitiveEntityId" ASC, lds."dimension" ASC`,
        [input.userId, ...entityIds],
      ),
    );
    const grouped = new Map<
      string,
      {
        state: Row;
        dimensions: LearnerStateDimensionReadRecord[];
      }
    >();
    for (const row of rows) {
      const cognitiveEntityId = stringValue(
        rowValue(row, "cognitiveEntityId"),
        "cognitiveEntityId",
      );
      const current = grouped.get(cognitiveEntityId) ?? {
        state: row,
        dimensions: [],
      };
      const dimension = nullableString(rowValue(row, "dimension"));
      if (dimension) {
        const dimensionInferenceVersion = numberValue(
          rowValue(row, "dimensionInferenceVersion"),
          "dimension inferenceVersion",
        );
        if (dimensionInferenceVersion <= 0) return null;
        current.dimensions.push({
          dimension,
          estimate: nullableNumber(rowValue(row, "dimensionEstimate")),
          evidenceSufficiency: numberValue(
            rowValue(row, "dimensionEvidenceSufficiency"),
            "dimension evidenceSufficiency",
          ),
          evidenceSufficiencyReasons: decodeJson(
            rowValue(row, "evidenceSufficiencyReasons"),
          ),
          status: stringValue(
            rowValue(row, "dimensionStatus"),
            "dimension status",
          ),
          effectiveEvidenceWeight: numberValue(
            rowValue(row, "evidenceWeight"),
            "dimension evidenceWeight",
          ),
          lastObservedAt: nullableDate(rowValue(row, "lastObservedAt")),
        });
      }
      grouped.set(cognitiveEntityId, current);
    }

    const output: LearnerStateProjectionReadRecord[] = [];
    for (const cognitiveEntityId of entityIds) {
      const group = grouped.get(cognitiveEntityId);
      if (!group) {
        if (materializedIds.has(cognitiveEntityId)) return null;
        output.push(unobservedLearnerStateProjection(cognitiveEntityId));
        continue;
      }
      if (group.dimensions.length !== COGNITIVE_DIMENSIONS.length) {
        return null;
      }
      const dimensions = new Set(
        group.dimensions.map((dimension) => dimension.dimension),
      );
      if (
        dimensions.size !== COGNITIVE_DIMENSIONS.length ||
        COGNITIVE_DIMENSIONS.some((dimension) => !dimensions.has(dimension))
      ) {
        return null;
      }
      const revision = numberValue(
        rowValue(group.state, "revision"),
        "revision",
      );
      const inferenceVersion = numberValue(
        rowValue(group.state, "inferenceVersion"),
        "inferenceVersion",
      );
      if (revision <= 0 || inferenceVersion <= 0) return null;
      const updatedAt = dateValue(rowValue(group.state, "updatedAt"));
      if (updatedAt.getTime() > input.asOf.getTime()) return null;
      output.push({
        cognitiveEntityId,
        overallEstimate: nullableNumber(rowValue(group.state, "estimate")),
        evidenceSufficiency: numberValue(
          rowValue(group.state, "evidenceSufficiency"),
          "evidenceSufficiency",
        ),
        status: stringValue(rowValue(group.state, "status"), "status"),
        inferencePolicyVersion: inferenceVersion,
        stateRevision: revision,
        evidenceCutoffAt: nullableDate(
          rowValue(group.state, "evidenceCutoffAt"),
        ),
        lifecycleCutoffAt: nullableDate(
          rowValue(group.state, "lifecycleCutoffAt"),
        ),
        dimensions: group.dimensions,
      });
    }
    return output;
  }
}
