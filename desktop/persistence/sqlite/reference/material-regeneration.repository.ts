import type { EntityManager } from "@mikro-orm/core";
import type { MaterialRegenerationRepository } from "@xue-learn/core/domain";
import { MikroOrmMaterialCheckCompletionRepository } from "./material-check-completion.repository.ts";

type Row = Readonly<Record<string, unknown>>;

const rows = (value: unknown): readonly Row[] =>
  Array.isArray(value)
    ? (value as Row[])
    : value &&
        typeof value === "object" &&
        "rows" in value &&
        Array.isArray((value as { rows?: unknown }).rows)
      ? (value as { rows: Row[] }).rows
      : [];

const val = (row: Row, key: string) =>
  row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];

const table = (em: EntityManager, name: string) => {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
};

function affected(result: unknown): number {
  if (typeof result === "number") return result;
  if (!result || typeof result !== "object") return 0;
  const row = result as Record<string, unknown>;
  for (const key of [
    "affectedRows",
    "rowCount",
    "changes",
    "numAffectedRows",
    "numInsertedOrUpdatedRows",
  ]) {
    const value = row[key];
    if (typeof value === "number") return value;
    if (typeof value === "bigint") return Number(value);
  }
  return 0;
}

function claimed(result: unknown): boolean {
  return rows(result).length === 1 || affected(result) === 1;
}

export class MikroOrmMaterialRegenerationRepository
  implements MaterialRegenerationRepository
{
  constructor(private readonly em: EntityManager) {}

  private exec(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }

  private async owns(userId: string, unitId: string) {
    return Boolean(
      rows(
        await this.exec(
          `SELECT u."id" FROM ${table(this.em, "LearningUnit")} u JOIN ${table(this.em, "LearningGoal")} g ON g."id"=u."goalId" WHERE u."id"=? AND g."userId"=? LIMIT 1`,
          [unitId, userId],
        ),
      )[0],
    );
  }

  async findSource(input: { userId: string; unitId: string }) {
    if (!(await this.owns(input.userId, input.unitId))) return null;
    const [sectionResult, legacyResult] = await Promise.all([
      this.exec(
        `SELECT s."id",s."title",s."contentRevision",s."generationStatus",m."sectionId" AS "materialSectionId",m."introduction",m."blocks",m."keyTakeaways" FROM ${table(this.em, "MainCourseSection")} s LEFT JOIN ${table(this.em, "UnitSectionMaterial")} m ON m."sectionId"=s."id" WHERE s."unitId"=? ORDER BY s."orderIndex" ASC`,
        [input.unitId],
      ),
      this.exec(
        `SELECT "introduction","sections","keyTakeaways" FROM ${table(this.em, "LearningMaterial")} WHERE "unitId"=? LIMIT 1`,
        [input.unitId],
      ),
    ]);
    const legacy = rows(legacyResult)[0];
    return {
      sections: rows(sectionResult).map((row) =>
        val(row, "materialSectionId") == null
          ? null
          : {
              id: String(val(row, "id")),
              title: String(val(row, "title")),
              contentRevision: Number(val(row, "contentRevision") ?? 0),
              generationStatus: String(val(row, "generationStatus")),
              introduction: String(val(row, "introduction") ?? ""),
              blocks: String(val(row, "blocks") ?? "[]"),
              keyTakeaways: String(val(row, "keyTakeaways") ?? "[]"),
            },
      ),
      legacy: legacy
        ? {
            introduction: String(val(legacy, "introduction") ?? ""),
            sections: String(val(legacy, "sections") ?? "[]"),
            keyTakeaways: String(val(legacy, "keyTakeaways") ?? "[]"),
          }
        : null,
    };
  }

  async persistSectionBlocks(input: {
    userId: string;
    unitId: string;
    sectionId: string;
    expectedSectionRevision: number;
    blocksJson: string;
  }) {
    if (!(await this.owns(input.userId, input.unitId))) {
      return { applied: false, contentRevision: input.expectedSectionRevision };
    }
    const now = new Date();
    const updated = await this.exec(
      `UPDATE ${table(this.em, "UnitSection")} SET "contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=? AND "unitId"=? AND "contentRevision"=? AND "generationStatus"='ready' RETURNING "contentRevision"`,
      [now, input.sectionId, input.unitId, input.expectedSectionRevision],
    );
    if (!claimed(updated)) {
      return { applied: false, contentRevision: input.expectedSectionRevision };
    }
    await this.exec(
      `UPDATE ${table(this.em, "UnitSectionMaterial")} SET "blocks"=?,"updatedAt"=? WHERE "sectionId"=?`,
      [input.blocksJson, now, input.sectionId],
    );
    await this.exec(
      `UPDATE ${table(this.em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`,
      [input.unitId],
    );
    const unit = rows(
      await this.exec(
        `SELECT "contentRevision" FROM ${table(this.em, "LearningUnit")} WHERE "id"=?`,
        [input.unitId],
      ),
    )[0];
    return {
      applied: true,
      contentRevision: Number(val(unit!, "contentRevision")),
    };
  }

  async persistLegacyBlocks(input: {
    userId: string;
    goalId: string;
    unitId: string;
    expectedContentRevision: number;
    blocksJson: string;
    nextGraphStateJson: string;
    tasks: readonly import("@xue-learn/core/domain").MaterialCheckTaskDefinition[];
  }) {
    if (!(await this.owns(input.userId, input.unitId))) {
      return { applied: false, contentRevision: input.expectedContentRevision };
    }
    const claimedUnit = await this.exec(
      `UPDATE ${table(this.em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=? AND "goalId"=? AND "contentRevision"=? RETURNING "contentRevision"`,
      [input.unitId, input.goalId, input.expectedContentRevision],
    );
    if (!claimed(claimedUnit)) {
      return { applied: false, contentRevision: input.expectedContentRevision };
    }
    const now = new Date();
    await this.exec(
      `UPDATE ${table(this.em, "LearningMaterial")} SET "sections"=?,"updatedAt"=? WHERE "unitId"=?`,
      [input.blocksJson, now, input.unitId],
    );
    await this.exec(
      `UPDATE ${table(this.em, "UnitSessionState")} SET "graphState"=?,"updatedAt"=? WHERE "unitId"=?`,
      [input.nextGraphStateJson, now, input.unitId],
    );
    if (input.tasks.length) {
      await new MikroOrmMaterialCheckCompletionRepository(this.em).publishTasks({
        userId: input.userId,
        goalId: input.goalId,
        unitId: input.unitId,
        tasks: input.tasks,
      });
    }
    const returned = rows(claimedUnit)[0];
    return {
      applied: true,
      contentRevision: returned
        ? Number(val(returned, "contentRevision"))
        : input.expectedContentRevision + 1,
    };
  }
}
