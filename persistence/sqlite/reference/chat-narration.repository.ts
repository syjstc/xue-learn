import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  ChatNarrationAudioRecord,
  ChatNarrationRepository,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue, referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;

function rows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? (value as Row[]) : [];
  }
  return [];
}

function value(row: Row, key: string): unknown {
  return row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
}

function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function parseJson(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try { return JSON.parse(input); } catch { return input; }
}

function audioRecord(row: Row): ChatNarrationAudioRecord {
  const date = (key: string) => nullableReferenceDateValue(value(row, key), key);
  return {
    id: String(value(row, "id")),
    userId: String(value(row, "userId")),
    unitId: String(value(row, "unitId")),
    sectionId: value(row, "sectionId") == null ? null : String(value(row, "sectionId")),
    scopeKey: String(value(row, "scopeKey")),
    contentKey: String(value(row, "contentKey")),
    textHash: String(value(row, "textHash")),
    provider: String(value(row, "provider")),
    model: String(value(row, "model")),
    speaker: String(value(row, "speaker")),
    timingVersion: String(value(row, "timingVersion")),
    status: String(value(row, "status")),
    generationStartedAt: date("generationStartedAt"),
    error: String(value(row, "error") ?? ""),
    objectKey: value(row, "objectKey") == null ? null : String(value(row, "objectKey")),
    mimeType: value(row, "mimeType") == null ? null : String(value(row, "mimeType")),
    durationMs: value(row, "durationMs") == null ? null : Number(value(row, "durationMs")),
    chars: parseJson(value(row, "chars")),
    createdAt: date("createdAt") ?? new Date(0),
  };
}

export class MikroOrmChatNarrationRepository implements ChatNarrationRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params, undefined, this.em.getTransactionContext());
  }

  async readLearnerSettings(userId: string) {
    const row = rows(await this.execute(
      `SELECT "chatAudioEnabled", "learningViewMode" FROM ${table(this.em,"UserSettings")} WHERE "userId" = ? LIMIT 1`,
      [userId],
    ))[0];
    return row ? {
      chatAudioEnabled: value(row,"chatAudioEnabled") === true || Number(value(row,"chatAudioEnabled")) === 1,
      learningViewMode: String(value(row,"learningViewMode") ?? "guided"),
    } : null;
  }

  async claim(input: Parameters<ChatNarrationRepository["claim"]>[0]) {
    return this.em.transactional(async em => {
      const key = [input.userId,input.unitId,input.scopeKey,input.contentKey,input.textHash,input.provider,input.model,input.speaker];
      let row = rows(await em.getConnection().execute(
        `SELECT * FROM ${table(em,"ChatNarrationAudio")} WHERE "userId"=? AND "unitId"=? AND "scopeKey"=? AND "contentKey"=? AND "textHash"=? AND "provider"=? AND "model"=? AND "speaker"=? LIMIT 1`,key,undefined,em.getTransactionContext()))[0];
      if (row && String(value(row,"status")) === "ready") return { row: audioRecord(row), claimed:false };
      if (row && String(value(row,"status")) === "building") {
        const started=value(row,"generationStartedAt");
        if(started && referenceDateValue(started, "narration generationStartedAt") > input.staleBefore) return {row:audioRecord(row),claimed:false};
      }
      const now=new Date();
      if(row){
        const result=rows(await em.getConnection().execute(`UPDATE ${table(em,"ChatNarrationAudio")} SET "status"='building',"generationStartedAt"=?,"error"='',"updatedAt"=? WHERE "id"=? AND ("status"='failed' OR "generationStartedAt"<? OR "generationStartedAt" IS NULL) RETURNING *`,[now,now,value(row,"id"),input.staleBefore],undefined,em.getTransactionContext()));
        row=result[0] ?? rows(await em.getConnection().execute(`SELECT * FROM ${table(em,"ChatNarrationAudio")} WHERE "id"=? LIMIT 1`,[value(row,"id")],undefined,em.getTransactionContext()))[0];
        return {row:audioRecord(row!),claimed:result.length===1};
      }
      const id=randomUUID();
      const inserted=rows(await em.getConnection().execute(`INSERT INTO ${table(em,"ChatNarrationAudio")} ("id","userId","unitId","sectionId","scopeKey","contentKey","textHash","provider","model","speaker","timingVersion","status","generationStartedAt","error","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,'building',?,'',?,?) ON CONFLICT DO NOTHING RETURNING *`,[id,input.userId,input.unitId,input.sectionId,input.scopeKey,input.contentKey,input.textHash,input.provider,input.model,input.speaker,input.timingVersion,now,now,now],undefined,em.getTransactionContext()));
      row=inserted[0] ?? rows(await em.getConnection().execute(`SELECT * FROM ${table(em,"ChatNarrationAudio")} WHERE "userId"=? AND "unitId"=? AND "scopeKey"=? AND "contentKey"=? AND "textHash"=? AND "provider"=? AND "model"=? AND "speaker"=? LIMIT 1`,key,undefined,em.getTransactionContext()))[0];
      if(!row)throw new Error("Unable to claim narration audio row");
      return {row:audioRecord(row),claimed:inserted.length===1};
    });
  }

  async markReady(input: Parameters<ChatNarrationRepository["markReady"]>[0]) {
    const result=rows(await this.execute(`UPDATE ${table(this.em,"ChatNarrationAudio")} SET "status"='ready',"generationStartedAt"=NULL,"error"='',"objectKey"=?,"mimeType"=?,"durationMs"=?,"chars"=?,"updatedAt"=? WHERE "id"=? RETURNING *`,[input.objectKey,input.mimeType,input.durationMs,JSON.stringify(input.chars),new Date(),input.id]));
    if(!result[0])throw new Error("Narration audio row not found");
    return audioRecord(result[0]);
  }

  async markFailed(input: Parameters<ChatNarrationRepository["markFailed"]>[0]) {
    if(input.ids.length===0)return 0;
    const result=rows(await this.execute(`UPDATE ${table(this.em,"ChatNarrationAudio")} SET "status"='failed',"generationStartedAt"=NULL,"error"=?,"updatedAt"=? WHERE "status"='building' AND "id" IN (${input.ids.map(()=>"?").join(",")}) RETURNING "id"`,[input.error,new Date(),...input.ids]));
    return result.length;
  }

  async loadMaterial(input: Parameters<ChatNarrationRepository["loadMaterial"]>[0]) {
    const owner=rows(await this.execute(`SELECT u."goalId" FROM ${table(this.em,"LearningUnit")} u JOIN ${table(this.em,"LearningGoal")} g ON g."id"=u."goalId" WHERE u."id"=? AND g."userId"=? LIMIT 1`,[input.unitId,input.userId]))[0];
    if(!owner)return null;
    const material=input.sectionId
      ? rows(await this.execute(`SELECT m."introduction",m."blocks" AS "sections",m."keyTakeaways" FROM ${table(this.em,"MainCourseSection")} s JOIN ${table(this.em,"UnitSectionMaterial")} m ON m."sectionId"=s."id" WHERE s."id"=? AND s."unitId"=? LIMIT 1`,[input.sectionId,input.unitId]))[0]
      : rows(await this.execute(`SELECT "introduction","sections","keyTakeaways" FROM ${table(this.em,"LearningMaterial")} WHERE "unitId"=? LIMIT 1`,[input.unitId]))[0];
    return {goalId:String(value(owner,"goalId")),material:material?{introduction:String(value(material,"introduction")??""),sections:String(value(material,"sections")??"[]"),keyTakeaways:String(value(material,"keyTakeaways")??"[]")}:null};
  }

  async listReady(input: Parameters<ChatNarrationRepository["listReady"]>[0]) {
    return rows(await this.execute(`SELECT * FROM ${table(this.em,"ChatNarrationAudio")} WHERE "userId"=? AND "unitId"=? AND "scopeKey"=? AND "status"='ready' AND "provider"=? AND "model"=? AND "speaker"=? ORDER BY "createdAt" ASC`,[input.userId,input.unitId,input.scopeKey,input.provider,input.model,input.speaker])).map(audioRecord);
  }

  async findReadyOwned(input: Parameters<ChatNarrationRepository["findReadyOwned"]>[0]) {
    const row=rows(await this.execute(`SELECT * FROM ${table(this.em,"ChatNarrationAudio")} WHERE "id"=? AND "userId"=? AND "unitId"=? AND "status"='ready' LIMIT 1`,[input.id,input.userId,input.unitId]))[0];
    return row?audioRecord(row):null;
  }
}
