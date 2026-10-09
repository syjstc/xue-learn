import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { ScenarioTheaterRunRecord, ScenarioTheaterSessionRepository } from "@xue-learn/core/domain";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => Array.isArray(value) ? value as Row[] : value && typeof value === "object" && "rows" in value && Array.isArray((value as { rows?: unknown }).rows) ? (value as { rows: Row[] }).rows : [];
const bool = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";
const parsed = (value: unknown, fallback: unknown) => { if (typeof value !== "string") return value ?? fallback; try { return JSON.parse(value); } catch { return fallback; } };
const table = (em: EntityManager, name: string) => { const schema = em.schema ?? em.config?.getSchema(); const quoted = `"${name.replaceAll('"','""')}"`; return schema ? `"${schema.replaceAll('"','""')}".${quoted}` : quoted; };

function run(row: Row | undefined): ScenarioTheaterRunRecord | null {
  return row ? { id: String(row.id), theaterRevision: Number(row.theaterRevision), runVersion: Number(row.runVersion), status: String(row.status), currentSceneId: row.currentSceneId == null ? null : String(row.currentSceneId), metersJson: parsed(row.metersJson, {}), pathJson: parsed(row.pathJson, []), endingId: row.endingId == null ? null : String(row.endingId), startedAt: referenceDateValue(row.startedAt, "scenario theater run startedAt"), completedAt: nullableReferenceDateValue(row.completedAt, "scenario theater run completedAt") } : null;
}

export class MikroOrmScenarioTheaterSessionRepository implements ScenarioTheaterSessionRepository {
  constructor(private readonly em: EntityManager) {}
  private execute(sql: string, params: unknown[] = [], method?: "all" | "run") { return this.em.getConnection().execute(sql, params, method, this.em.getTransactionContext()); }
  async load(input: { userId: string; unitId: string }) {
    const owner = rows(await this.execute(`SELECT goal."id" AS "goalId" FROM ${table(this.em,"LearningUnit")} unit JOIN ${table(this.em,"LearningGoal")} goal ON goal."id" = unit."goalId" WHERE unit."id" = ? AND goal."userId" = ? LIMIT 1`, [input.unitId,input.userId]))[0];
    if (!owner) return null;
    const theaterRow = rows(await this.execute(`SELECT "id","revision","status","recommended","recommendation","definitionJson","generationError" FROM ${table(this.em,"UnitScenarioTheater")} WHERE "unitId" = ? LIMIT 1`, [input.unitId]))[0];
    if (!theaterRow) return { goalId: String(owner.goalId), theater: null, scenes: [], activeRun: null, completedOnce: false };
    const [sceneRows, runRows, completedRows] = await Promise.all([
      this.execute(`SELECT "sceneId","status","contentJson" FROM ${table(this.em,"ScenarioTheaterScene")} WHERE "theaterId" = ? AND "theaterRevision" = ?`, [theaterRow.id,theaterRow.revision]),
      this.execute(`SELECT * FROM ${table(this.em,"ScenarioTheaterRun")} WHERE "userId" = ? AND "unitId" = ? AND "theaterRevision" = ? AND "status" = 'active' ORDER BY "updatedAt" DESC LIMIT 1`, [input.userId,input.unitId,theaterRow.revision]),
      this.execute(`SELECT COUNT(*) AS "count" FROM ${table(this.em,"ScenarioTheaterRun")} WHERE "userId" = ? AND "unitId" = ? AND "status" = 'completed'`, [input.userId,input.unitId]),
    ]);
    return { goalId: String(owner.goalId), theater: { id: String(theaterRow.id), revision: Number(theaterRow.revision), status: String(theaterRow.status), recommended: bool(theaterRow.recommended), recommendation: String(theaterRow.recommendation ?? ""), definitionJson: parsed(theaterRow.definitionJson, null), generationError: String(theaterRow.generationError ?? "") }, scenes: rows(sceneRows).map(item => ({ sceneId: String(item.sceneId), status: String(item.status), contentJson: parsed(item.contentJson, null) })), activeRun: run(rows(runRows)[0]), completedOnce: Number(rows(completedRows)[0]?.count ?? 0) > 0 };
  }
  async createOrReuse(input: { userId: string; unitId: string; theaterId: string; theaterRevision: number; initialSceneId: string; metersJson: unknown }) {
    const existing = run(rows(await this.execute(`SELECT * FROM ${table(this.em,"ScenarioTheaterRun")} WHERE "userId" = ? AND "unitId" = ? AND "theaterRevision" = ? AND "status" = 'active' ORDER BY "updatedAt" DESC LIMIT 1`, [input.userId,input.unitId,input.theaterRevision]))[0]);
    if (existing) return existing;
    const id = randomUUID(), now = new Date();
    await this.execute(`INSERT INTO ${table(this.em,"ScenarioTheaterRun")} ("id","theaterId","unitId","userId","theaterRevision","runVersion","status","currentSceneId","metersJson","pathJson","startedAt","updatedAt") VALUES (?,?,?,?,?,1,'active',?,?,?, ?,?)`, [id,input.theaterId,input.unitId,input.userId,input.theaterRevision,input.initialSceneId,JSON.stringify(input.metersJson),JSON.stringify([]),now,now]);
    return (await this.findRun({ userId: input.userId, unitId: input.unitId, runId: id }))!;
  }
  async restart(input: { userId: string; unitId: string; theaterId: string; theaterRevision: number; initialSceneId: string; metersJson: unknown }) {
    const now = new Date();
    await this.execute(`UPDATE ${table(this.em,"ScenarioTheaterRun")} SET "status" = 'abandoned', "updatedAt" = ? WHERE "userId" = ? AND "unitId" = ? AND "status" = 'active'`, [now,input.userId,input.unitId]);
    const id = randomUUID();
    await this.execute(`INSERT INTO ${table(this.em,"ScenarioTheaterRun")} ("id","theaterId","unitId","userId","theaterRevision","runVersion","status","currentSceneId","metersJson","pathJson","startedAt","updatedAt") VALUES (?,?,?,?,?,1,'active',?,?,?, ?,?)`, [id,input.theaterId,input.unitId,input.userId,input.theaterRevision,input.initialSceneId,JSON.stringify(input.metersJson),JSON.stringify([]),now,now]);
    const completed = rows(await this.execute(`SELECT COUNT(*) AS "count" FROM ${table(this.em,"ScenarioTheaterRun")} WHERE "userId" = ? AND "unitId" = ? AND "status" = 'completed'`, [input.userId,input.unitId]))[0];
    return { run: (await this.findRun({ userId: input.userId, unitId: input.unitId, runId: id }))!, completedOnce: Number(completed?.count ?? 0) > 0 };
  }
  async commitChoice(input: { userId: string; unitId: string; runId: string; theaterId: string; theaterRevision: number; runVersion: number; sceneId: string; currentSceneId: string | null; metersJson: unknown; pathJson: unknown; endingId: string | null; completed: boolean }) {
    const found = rows(await this.execute(`SELECT "id" FROM ${table(this.em,"ScenarioTheaterRun")} WHERE "id" = ? AND "userId" = ? AND "unitId" = ? LIMIT 1`, [input.runId,input.userId,input.unitId]))[0];
    if (!found) return "missing" as const;
    const now = new Date();
    const result = await this.execute(`UPDATE ${table(this.em,"ScenarioTheaterRun")} SET "runVersion" = "runVersion" + 1, "currentSceneId" = ?, "metersJson" = ?, "pathJson" = ?, "endingId" = ?, "status" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ? AND "theaterId" = ? AND "theaterRevision" = ? AND "runVersion" = ? AND "currentSceneId" = ? AND "status" = 'active'`, [input.currentSceneId,JSON.stringify(input.metersJson),JSON.stringify(input.pathJson),input.endingId,input.completed ? "completed" : "active",input.completed ? now : null,now,input.runId,input.theaterId,input.theaterRevision,input.runVersion,input.sceneId], "run");
    const affected = typeof result === "number" ? result : result && typeof result === "object" ? Number((result as { affectedRows?: unknown; rowCount?: unknown }).affectedRows ?? (result as { rowCount?: unknown }).rowCount ?? 0) : 0;
    return affected === 1 ? "saved" as const : "conflict" as const;
  }
  async findRun(input: { userId: string; unitId: string; runId: string }) { return run(rows(await this.execute(`SELECT * FROM ${table(this.em,"ScenarioTheaterRun")} WHERE "id" = ? AND "userId" = ? AND "unitId" = ? LIMIT 1`, [input.runId,input.userId,input.unitId]))[0]); }
}
