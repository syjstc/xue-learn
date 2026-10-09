import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  ScenarioTheaterGenerationRepository,
  ScenarioTheaterRecord,
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
const json = (v: unknown, f: unknown = null) => {
  if (typeof v !== "string") return v ?? f;
  try {
    return JSON.parse(v);
  } catch {
    return f;
  }
};
const table = (em: EntityManager, n: string) => {
  const s = em.schema ?? em.config?.getSchema();
  const q = `"${n.replaceAll('"', '""')}"`;
  return s ? `"${s.replaceAll('"', '""')}".${q}` : q;
};
const affected = (v: unknown) =>
  typeof v === "number"
    ? v
    : v && typeof v === "object"
      ? Number(
          (v as { affectedRows?: unknown; rowCount?: unknown }).affectedRows ??
            (v as { rowCount?: unknown }).rowCount ??
            0,
        )
      : 0;
function theater(r: Row | undefined): ScenarioTheaterRecord | null {
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
          "scenario theater updatedAt",
        ),
      }
    : null;
}
export class MikroOrmScenarioTheaterGenerationRepository implements ScenarioTheaterGenerationRepository {
  constructor(private readonly em: EntityManager) {}
  private exec(sql: string, p: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, p, undefined, this.em.getTransactionContext());
  }
  async findContext(input: { userId?: string; unitId: string }) {
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
  async findTheater(unitId: string) {
    return theater(
      rows(
        await this.exec(
          `SELECT * FROM ${table(this.em, "UnitScenarioTheater")} WHERE "unitId"=? LIMIT 1`,
          [unitId],
        ),
      )[0],
    );
  }
  async recommend(input: { unitId: string; recommendation: string }) {
    const now = new Date(),
      id = randomUUID();
    await this.exec(
      `INSERT INTO ${table(this.em, "UnitScenarioTheater")} ("id","unitId","revision","status","source","recommended","recommendation","generationInputHash","generationError","createdAt","updatedAt") VALUES (?,?,1,'pending','recommended',?,?, '', '',?,?) ON CONFLICT ("unitId") DO UPDATE SET "recommended"=?,"recommendation"=?,"updatedAt"=?`,
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
    return (await this.findTheater(input.unitId))!;
  }
  async invalidate(unitId: string) {
    const t = await this.findTheater(unitId);
    if (!t) return false;
    const now = new Date();
    await this.exec(
      `UPDATE ${table(this.em, "ScenarioTheaterRun")} SET "status"='abandoned',"updatedAt"=? WHERE "theaterId"=? AND "status"='active'`,
      [now, t.id],
    );
    await this.exec(
      `DELETE FROM ${table(this.em, "ScenarioTheaterScene")} WHERE "theaterId"=?`,
      [t.id],
    );
    await this.exec(
      `UPDATE ${table(this.em, "UnitScenarioTheater")} SET "status"='pending',"definitionJson"=NULL,"generationError"='',"generationInputHash"='',"updatedAt"=? WHERE "id"=?`,
      [now, t.id],
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
    abandonActiveRuns: boolean;
  }) {
    const existing = await this.findTheater(input.unitId),
      now = new Date(),
      id = existing?.id ?? randomUUID();
    await this.exec(
      `INSERT INTO ${table(this.em, "UnitScenarioTheater")} ("id","unitId","revision","status","source","recommended","recommendation","generationInputHash","generationError","generationStartedAt","createdAt","updatedAt") VALUES (?,?,?,'preparing',?,?,?,?, '',?,?,?) ON CONFLICT ("unitId") DO UPDATE SET "revision"=?,"status"='preparing',"generationInputHash"=?,"generationError"='',"generationStartedAt"=?,"updatedAt"=?`,
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
    if (input.abandonActiveRuns)
      await this.exec(
        `UPDATE ${table(this.em, "ScenarioTheaterRun")} SET "status"='abandoned',"updatedAt"=? WHERE "theaterId"=? AND "status"='active'`,
        [now, id],
      );
    return (await this.findTheater(input.unitId))!;
  }
  async publishPrepared(input: {
    theaterId: string;
    revision: number;
    definitionJson: unknown;
    sceneIds: readonly string[];
  }) {
    await this.exec(
      `DELETE FROM ${table(this.em, "ScenarioTheaterScene")} WHERE "theaterId"=? AND "theaterRevision"=?`,
      [input.theaterId, input.revision],
    );
    const now = new Date();
    for (const sceneId of input.sceneIds)
      await this.exec(
        `INSERT INTO ${table(this.em, "ScenarioTheaterScene")} ("id","theaterId","theaterRevision","sceneId","status","attemptCount","generationError","createdAt","updatedAt") VALUES (?,?,?,?,'pending',0,'',?,?)`,
        [randomUUID(), input.theaterId, input.revision, sceneId, now, now],
      );
    await this.exec(
      `UPDATE ${table(this.em, "UnitScenarioTheater")} SET "status"='prepared',"definitionJson"=?,"generationError"='',"updatedAt"=? WHERE "id"=?`,
      [JSON.stringify(input.definitionJson), now, input.theaterId],
    );
  }
  async markTheaterFailed(input: { theaterId: string; error: string }) {
    await this.exec(
      `UPDATE ${table(this.em, "UnitScenarioTheater")} SET "status"='failed',"generationError"=?,"updatedAt"=? WHERE "id"=?`,
      [input.error, new Date(), input.theaterId],
    );
  }
  async listScenes(input: { theaterId: string; revision: number }) {
    return rows(
      await this.exec(
        `SELECT "sceneId","status","contentJson","attemptCount" FROM ${table(this.em, "ScenarioTheaterScene")} WHERE "theaterId"=? AND "theaterRevision"=?`,
        [input.theaterId, input.revision],
      ),
    ).map((r) => ({
      sceneId: String(val(r, "sceneId")),
      status: String(val(r, "status")),
      contentJson: json(val(r, "contentJson"), null),
      attemptCount: Number(val(r, "attemptCount") ?? 0),
    }));
  }
  async claimScene(input: {
    theaterId: string;
    revision: number;
    sceneId: string;
    staleBefore: Date;
  }) {
    const now = new Date();
    const r = await this.exec(
      `UPDATE ${table(this.em, "ScenarioTheaterScene")} SET "status"='building',"attemptCount"="attemptCount"+1,"generationStartedAt"=?,"generationError"='',"updatedAt"=? WHERE "theaterId"=? AND "theaterRevision"=? AND "sceneId"=? AND ("status"='pending' OR ("status"='fallback' AND "attemptCount"<2) OR ("status"='building' AND "generationStartedAt"<?)) RETURNING "sceneId"`,
      [
        now,
        now,
        input.theaterId,
        input.revision,
        input.sceneId,
        input.staleBefore,
      ],
    );
    return rows(r).length === 1 || affected(r) === 1;
  }
  async saveScenes(input: {
    theaterId: string;
    revision: number;
    scenes: readonly {
      sceneId: string;
      status: "ready" | "fallback";
      contentJson?: unknown;
      error: string;
    }[];
  }) {
    const now = new Date();
    for (const s of input.scenes)
      await this.exec(
        `UPDATE ${table(this.em, "ScenarioTheaterScene")} SET "status"=?,"contentJson"=?,"generationError"=?,"updatedAt"=? WHERE "theaterId"=? AND "theaterRevision"=? AND "sceneId"=?`,
        [
          s.status,
          s.contentJson === undefined ? null : JSON.stringify(s.contentJson),
          s.error,
          now,
          input.theaterId,
          input.revision,
          s.sceneId,
        ],
      );
  }
  async failClaimedScenes(input: {
    theaterId: string;
    revision: number;
    sceneIds: readonly string[];
    error: string;
  }) {
    if (!input.sceneIds.length) return;
    await this.exec(
      `UPDATE ${table(this.em, "ScenarioTheaterScene")} SET "status"='fallback',"generationError"=?,"updatedAt"=? WHERE "theaterId"=? AND "theaterRevision"=? AND "status"='building' AND "sceneId" IN (${input.sceneIds.map(() => "?").join(",")})`,
      [
        input.error,
        new Date(),
        input.theaterId,
        input.revision,
        ...input.sceneIds,
      ],
    );
  }
  async findActiveRun(input: {
    userId: string;
    unitId: string;
    runId: string;
  }) {
    const r = rows(
      await this.exec(
        `SELECT "theaterRevision","currentSceneId" FROM ${table(this.em, "ScenarioTheaterRun")} WHERE "id"=? AND "userId"=? AND "unitId"=? AND "status"='active' LIMIT 1`,
        [input.runId, input.userId, input.unitId],
      ),
    )[0];
    return r
      ? {
          theaterRevision: Number(val(r, "theaterRevision")),
          currentSceneId:
            val(r, "currentSceneId") == null
              ? null
              : String(val(r, "currentSceneId")),
        }
      : null;
  }
  async markReady(input: { theaterId: string; definitionJson?: unknown }) {
    const now = new Date();
    if (input.definitionJson === undefined)
      await this.exec(
        `UPDATE ${table(this.em, "UnitScenarioTheater")} SET "status"='ready',"generationError"='',"updatedAt"=? WHERE "id"=?`,
        [now, input.theaterId],
      );
    else
      await this.exec(
        `UPDATE ${table(this.em, "UnitScenarioTheater")} SET "status"='ready',"definitionJson"=?,"generationError"='',"updatedAt"=? WHERE "id"=?`,
        [JSON.stringify(input.definitionJson), now, input.theaterId],
      );
  }
  async bumpContentRevision(unitId: string) {
    await this.exec(
      `UPDATE ${table(this.em, "LearningUnit")} SET "contentRevision"="contentRevision"+1 WHERE "id"=?`,
      [unitId],
    );
    const r = rows(
      await this.exec(
        `SELECT "contentRevision" FROM ${table(this.em, "LearningUnit")} WHERE "id"=?`,
        [unitId],
      ),
    )[0];
    return Number(val(r!, "contentRevision"));
  }
}
