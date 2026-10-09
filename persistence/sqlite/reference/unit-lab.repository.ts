import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  UnitLabContentReadRecord,
  UnitLabGenerationContext,
  UnitLabRecord,
  UnitLabRepository,
  UnitLabSessionReadRecord,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (v: unknown): readonly Row[] =>
  Array.isArray(v)
    ? (v as Row[])
    : v &&
        typeof v === "object" &&
        "rows" in v &&
        Array.isArray((v as { rows?: unknown }).rows)
      ? (v as { rows: Row[] }).rows
      : [];
const val = (r: Row, k: string) => r[k] ?? r[k[0]?.toLowerCase() + k.slice(1)];
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const affected = (result: unknown) =>
  typeof result === "number"
    ? result
    : result && typeof result === "object"
      ? Number(
          (result as { affectedRows?: unknown; rowCount?: unknown })
            .affectedRows ??
            (result as { rowCount?: unknown }).rowCount ??
            (result as { changes?: unknown }).changes ??
            0,
        )
      : 0;
const json = (v: unknown, fallback: unknown = null) => {
  if (typeof v !== "string") return v ?? fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
const table = (em: EntityManager, n: string) => {
  const s = em.schema ?? em.config?.getSchema();
  const q = `"${n.replaceAll('"', '""')}"`;
  return s ? `"${s.replaceAll('"', '""')}".${q}` : q;
};

function lab(r: Row | undefined): UnitLabRecord | null {
  return r
    ? {
        id: String(val(r, "id")),
        unitId: String(val(r, "unitId")),
        revision: Number(val(r, "revision")),
        status: String(val(r, "status")),
        source: String(val(r, "source")),
        recommended: bool(val(r, "recommended")),
        recommendation: String(val(r, "recommendation") ?? ""),
        definitionJson: json(val(r, "definitionJson"), null),
        generationInputHash: String(val(r, "generationInputHash") ?? ""),
        generationError: String(val(r, "generationError") ?? ""),
        updatedAt: referenceDateValue(
          val(r, "updatedAt"),
          "unit lab updatedAt",
        ),
      }
    : null;
}

export class MikroOrmUnitLabRepository implements UnitLabRepository {
  constructor(private readonly em: EntityManager) {}

  private exec(sql: string, p: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, p, undefined, this.em.getTransactionContext());
  }

  async findContext(input: {
    userId?: string;
    unitId: string;
  }): Promise<UnitLabGenerationContext | null> {
    const p: unknown[] = [input.unitId];
    let owner = "";
    if (input.userId) {
      owner = ` AND g."userId" = ?`;
      p.push(input.userId);
    }
    const r = rows(
      await this.exec(
        `SELECT u."id",u."title",u."contentSummary",u."goalId",u."contentRevision",g."title" AS "goalTitle",s."sq3rData",m."introduction",m."sections",m."keyTakeaways",m."unitId" AS "materialUnitId" FROM ${table(this.em, "LearningUnit")} u JOIN ${table(this.em, "LearningGoal")} g ON g."id"=u."goalId" LEFT JOIN ${table(this.em, "UnitSessionState")} s ON s."unitId"=u."id" LEFT JOIN ${table(this.em, "LearningMaterial")} m ON m."unitId"=u."id" WHERE u."id"=?${owner} LIMIT 1`,
        p,
      ),
    )[0];
    return r
      ? {
          unit: {
            id: String(val(r, "id")),
            title: String(val(r, "title")),
            contentSummary: String(val(r, "contentSummary") ?? ""),
            goalId: String(val(r, "goalId")),
            contentRevision: Number(val(r, "contentRevision") ?? 0),
            goalTitle: String(val(r, "goalTitle")),
          },
          sq3rData:
            val(r, "sq3rData") == null ? null : String(val(r, "sq3rData")),
          legacyMaterial:
            val(r, "materialUnitId") == null
              ? null
              : {
                  introduction: String(val(r, "introduction") ?? ""),
                  sections: String(val(r, "sections") ?? "[]"),
                  keyTakeaways: String(val(r, "keyTakeaways") ?? "[]"),
                },
        }
      : null;
  }

  async findLab(unitId: string) {
    return lab(
      rows(
        await this.exec(
          `SELECT * FROM ${table(this.em, "UnitLab")} WHERE "unitId"=? LIMIT 1`,
          [unitId],
        ),
      )[0],
    );
  }

  async recommend(input: { unitId: string; recommendation: string }) {
    const now = new Date();
    const id = randomUUID();
    await this.exec(
      `INSERT INTO ${table(this.em, "UnitLab")} ("id","unitId","revision","status","source","recommended","recommendation","generationInputHash","generationError","createdAt","updatedAt") VALUES (?,?,1,'pending','recommended',?,?, '', '',?,?) ON CONFLICT ("unitId") DO UPDATE SET "recommended"=?,"recommendation"=?,"updatedAt"=?`,
      [
        id,
        input.unitId,
        true,
        input.recommendation,
        now,
        now,
        true,
        input.recommendation,
        now,
      ],
    );
    return (await this.findLab(input.unitId))!;
  }

  async invalidate(unitId: string) {
    const existing = await this.findLab(unitId);
    if (!existing) return false;
    const now = new Date();
    await this.exec(
      `DELETE FROM ${table(this.em, "UnitLabVisit")} WHERE "labId"=?`,
      [existing.id],
    );
    await this.exec(
      `UPDATE ${table(this.em, "UnitLab")} SET "status"='pending',"definitionJson"=NULL,"generationError"='',"generationInputHash"='',"updatedAt"=? WHERE "id"=?`,
      [now, existing.id],
    );
    return true;
  }

  async enqueue(input: { type: string; payloadJson: string }) {
    const duplicate = rows(
      await this.exec(
        `SELECT "id" FROM ${table(this.em, "EventOutbox")} WHERE "type"=? AND "payload"=? AND "publishedAt" IS NULL AND "deadLetteredAt" IS NULL LIMIT 1`,
        [input.type, input.payloadJson],
      ),
    )[0];
    if (duplicate) return false;
    const now = new Date();
    await this.exec(
      `INSERT INTO ${table(this.em, "EventOutbox")} ("id","type","payload","createdAt") VALUES (?,?,?,?)`,
      [randomUUID(), input.type, input.payloadJson, now],
    );
    return true;
  }

  async beginPreparation(input: {
    unitId: string;
    revision: number;
    source: string;
    recommended: boolean;
    recommendation: string;
    inputHash: string;
  }) {
    const existing = await this.findLab(input.unitId);
    const now = new Date();
    const id = existing?.id ?? randomUUID();
    await this.exec(
      `INSERT INTO ${table(this.em, "UnitLab")} ("id","unitId","revision","status","source","recommended","recommendation","generationInputHash","generationError","generationStartedAt","createdAt","updatedAt") VALUES (?,?,?,'preparing',?,?,?,?, '',?,?,?) ON CONFLICT ("unitId") DO UPDATE SET "revision"=?,"status"='preparing',"generationInputHash"=?,"generationError"='',"generationStartedAt"=?,"updatedAt"=?`,
      [
        id,
        input.unitId,
        input.revision,
        input.source,
        input.recommended,
        input.recommendation,
        input.inputHash,
        now,
        now,
        now,
        input.revision,
        input.inputHash,
        now,
        now,
      ],
    );
    return (await this.findLab(input.unitId))!;
  }

  async publishPrepared(input: { labId: string; definitionJson: unknown }) {
    await this.exec(
      `UPDATE ${table(this.em, "UnitLab")} SET "status"='ready',"definitionJson"=?,"generationError"='',"updatedAt"=? WHERE "id"=?`,
      [JSON.stringify(input.definitionJson), new Date(), input.labId],
    );
  }

  async publishRegeneratedItem(input: {
    labId: string;
    expectedRevision: number;
    definitionJson: unknown;
  }) {
    const result = await this.exec(
      `UPDATE ${table(this.em, "UnitLab")} SET "status"='ready',"revision"="revision"+1,"definitionJson"=?,"generationError"='',"updatedAt"=? WHERE "id"=? AND "revision"=?`,
      [
        JSON.stringify(input.definitionJson),
        new Date(),
        input.labId,
        input.expectedRevision,
      ],
    );
    return affected(result) === 1;
  }

  async publishRegeneratedItemAndBumpContentRevision(input: {
    labId: string;
    unitId: string;
    expectedRevision: number;
    definitionJson: unknown;
  }) {
    const now = new Date();
    const result = await this.exec(
      `UPDATE ${table(this.em, "UnitLab")} SET "status"='ready',"revision"="revision"+1,"definitionJson"=?,"generationError"='',"updatedAt"=? WHERE "id"=? AND "revision"=?`,
      [
        JSON.stringify(input.definitionJson),
        now,
        input.labId,
        input.expectedRevision,
      ],
    );
    if (affected(result) !== 1) {
      return { applied: false, contentRevision: 0 };
    }

    const unitUpdate = await this.exec(
      `UPDATE ${table(this.em, "LearningUnit")} SET "contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=?`,
      [now, input.unitId],
    );
    if (affected(unitUpdate) !== 1) {
      throw new Error("unit_content_revision_not_found");
    }
    const row = rows(
      await this.exec(
        `SELECT "contentRevision" FROM ${table(this.em, "LearningUnit")} WHERE "id"=? LIMIT 1`,
        [input.unitId],
      ),
    )[0];
    return {
      applied: true,
      contentRevision: Number(val(row ?? {}, "contentRevision") ?? 0),
    };
  }

  async markFailed(input: { labId: string; error: string }) {
    await this.exec(
      `UPDATE ${table(this.em, "UnitLab")} SET "status"='failed',"generationError"=?,"updatedAt"=? WHERE "id"=?`,
      [input.error, new Date(), input.labId],
    );
  }

  async bumpContentRevision(unitId: string) {
    const now = new Date();
    await this.exec(
      `UPDATE ${table(this.em, "LearningUnit")} SET "contentRevision"="contentRevision"+1,"updatedAt"=? WHERE "id"=?`,
      [now, unitId],
    );
    const row = rows(
      await this.exec(
        `SELECT "contentRevision" FROM ${table(this.em, "LearningUnit")} WHERE "id"=? LIMIT 1`,
        [unitId],
      ),
    )[0];
    return Number(val(row ?? {}, "contentRevision") ?? 0);
  }

  async findLabContent(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitLabContentReadRecord | null> {
    const row = rows(
      await this.exec(
        `SELECT g."id" AS "goalId", lab."status", lab."recommended", lab."recommendation", lab."revision", lab."definitionJson", lab."generationError"
      FROM ${table(this.em, "LearningUnit")} unit JOIN ${table(this.em, "LearningGoal")} g ON g."id" = unit."goalId"
      JOIN ${table(this.em, "UnitLab")} lab ON lab."unitId" = unit."id"
      WHERE unit."id" = ? AND g."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    )[0];
    return row
      ? {
          goalId: String(val(row, "goalId")),
          status: String(val(row, "status")),
          recommended: bool(val(row, "recommended")),
          recommendation: String(val(row, "recommendation") ?? ""),
          revision: Number(val(row, "revision")),
          definitionJson: json(val(row, "definitionJson")),
          generationError: String(val(row, "generationError") ?? ""),
        }
      : null;
  }

  async findLabSession(input: {
    userId: string;
    unitId: string;
  }): Promise<UnitLabSessionReadRecord | null> {
    const labRow = rows(
      await this.exec(
        `SELECT lab."id", lab."status", lab."revision" FROM ${table(this.em, "UnitLab")} lab
      JOIN ${table(this.em, "LearningUnit")} unit ON unit."id" = lab."unitId" JOIN ${table(this.em, "LearningGoal")} goal ON goal."id" = unit."goalId"
      WHERE unit."id" = ? AND goal."userId" = ? LIMIT 1`,
        [input.unitId, input.userId],
      ),
    )[0];
    if (!labRow) return null;
    const visit = rows(
      await this.exec(
        `SELECT "status","completedAt" FROM ${table(this.em, "UnitLabVisit")} WHERE "userId"=? AND "unitId"=? LIMIT 1`,
        [input.userId, input.unitId],
      ),
    )[0];
    return {
      status: String(val(labRow, "status")),
      revision: Number(val(labRow, "revision")),
      openedOnce: Boolean(visit),
      completedOnce: Boolean(visit && val(visit, "completedAt")),
    };
  }

  async markOpened(input: { userId: string; unitId: string }) {
    const existing = await this.findLab(input.unitId);
    if (!existing) return;
    const now = new Date();
    await this.exec(
      `INSERT INTO ${table(this.em, "UnitLabVisit")} ("id","labId","unitId","userId","status","openedAt","updatedAt") VALUES (?,?,?,?,'opened',?,?) ON CONFLICT ("userId", "unitId") DO UPDATE SET "updatedAt"=?`,
      [randomUUID(), existing.id, input.unitId, input.userId, now, now, now],
    );
  }

  async markCompleted(input: { userId: string; unitId: string }) {
    await this.markOpened(input);
    const now = new Date();
    await this.exec(
      `UPDATE ${table(this.em, "UnitLabVisit")} SET "status"='completed',"completedAt"=COALESCE("completedAt", ?),"updatedAt"=? WHERE "userId"=? AND "unitId"=?`,
      [now, now, input.userId, input.unitId],
    );
  }
}
