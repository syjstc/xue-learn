import type { EntityManager } from "@mikro-orm/core";
import type {
  LlmLogQueryFilter,
  LlmLogQueryRepository,
} from "@xue-learn/core/domain";
import { referenceDateValue } from "./date-value.ts";

type Row = Readonly<Record<string, unknown>>;
const rows = (result: unknown): readonly Row[] => Array.isArray(result) ? result as Row[] : result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows?: unknown }).rows) ? (result as { rows: Row[] }).rows : [];
const value = (row: Row, key: string) => row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
const table = (em: EntityManager, name: string) => { const schema=em.schema??em.config?.getSchema(); const quoted=`"${name.replaceAll('"','""')}"`; return schema?`"${schema.replaceAll('"','""')}".${quoted}`:quoted; };

export function normalizeLlmLogDate(value: unknown): Date {
  return referenceDateValue(value, "LLM log date");
}

function normalized(row: Row): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...row };
  for (const key of ["createdAt"]) if (value(row,key) != null) result[key]=normalizeLlmLogDate(value(row,key));
  for (const key of ["structuredSyntaxRepaired"]) {
    const item=value(row,key); if(item!=null)result[key]=item===true||item===1||item==="1"||item==="true";
  }
  for (const key of ["durationMs","firstResponseMs","inputTokens","outputTokens","totalTokens","cacheReadTokens","cacheCreationTokens","reasoningTokens","structuredContractVersion","structuredAttempt","structuredUnknownKeyCount"]) {
    const item=value(row,key); if(item!=null)result[key]=Number(item);
  }
  for (const key of ["outputTps"]) { const item=value(row,key); if(item!=null)result[key]=Number(item); }
  return result;
}

export class MikroOrmLlmLogQueryRepository implements LlmLogQueryRepository {
  constructor(private readonly em: EntityManager) {}
  private exec(sql:string,params:unknown[]=[]){return this.em.getConnection().execute(sql,params,undefined,this.em.getTransactionContext())}
  async recoverRunningBefore(input:{cutoff:Date;error:string;durationMs:number}){
    const result=await this.exec(`UPDATE ${table(this.em,"LlmRequestLog")} SET "status"='error',"error"=?,"structuredFailureCategory"='interrupted',"durationMs"=? WHERE "status"='running' AND "createdAt"<?`,[input.error,input.durationMs,input.cutoff]);
    return typeof result==="number"?result:Number((result as {affectedRows?:number;rowCount?:number}).affectedRows??(result as {rowCount?:number}).rowCount??0);
  }
  private where(filter:LlmLogQueryFilter={}){
    const clauses:string[]=[];const params:unknown[]=[];
    const exact: Array<[keyof LlmLogQueryFilter,string]>=[["kind","kind"],["spanType","spanType"],["status","status"],["provider","provider"],["traceId","traceId"],["goalId","goalId"],["scope","scope"],["parentId","parentId"]];
    for(const [field,column] of exact){const item=filter[field];if(typeof item==="string"){clauses.push(`"${column}" = ?`);params.push(item)}}
    if(filter.operationContains){clauses.push(`"operation" LIKE ?`);params.push(`%${filter.operationContains}%`)}
    if(filter.traceIdPresent){clauses.push(`"traceId" IS NOT NULL`)}
    if(filter.goalIds){if(filter.goalIds.length===0)clauses.push("1=0");else{clauses.push(`"goalId" IN (${filter.goalIds.map(()=>"?").join(",")})`);params.push(...filter.goalIds)}}
    if(filter.createdAtGte){clauses.push(`"createdAt" >= ?`);params.push(filter.createdAtGte)}
    if(filter.structuredOnly){clauses.push(`"structuredContractId" IS NOT NULL AND "structuredInvocationId" IS NOT NULL`)}
    return {sql:clauses.length?` WHERE ${clauses.join(" AND ")}`:"",params};
  }
  async count(filter:LlmLogQueryFilter){const where=this.where(filter);const row=rows(await this.exec(`SELECT COUNT(*) AS "count" FROM ${table(this.em,"LlmRequestLog")}${where.sql}`,where.params))[0];return Number(value(row??{},"count")??0)}
  async list(input:{filter?:LlmLogQueryFilter;order?:"asc"|"desc";offset?:number;limit?:number}){const where=this.where(input.filter);const params=[...where.params];let suffix=` ORDER BY "createdAt" ${input.order==="asc"?"ASC":"DESC"}`;if(input.limit!=null){suffix+=" LIMIT ?";params.push(input.limit);if(input.offset!=null){suffix+=" OFFSET ?";params.push(input.offset)}}return rows(await this.exec(`SELECT * FROM ${table(this.em,"LlmRequestLog")}${where.sql}${suffix}`,params)).map(normalized)}
  async find(id:string){const row=rows(await this.exec(`SELECT * FROM ${table(this.em,"LlmRequestLog")} WHERE "id"=? LIMIT 1`,[id]))[0];return row?normalized(row):null}
  async deleteAll(){const existing=await this.count({});await this.exec(`DELETE FROM ${table(this.em,"LlmRequestLog")}`);return existing}
  async groupGoals(limit:number){return rows(await this.exec(`SELECT "goalId",COUNT(*) AS "logCount",MAX("createdAt") AS "lastAt" FROM ${table(this.em,"LlmRequestLog")} WHERE "goalId" IS NOT NULL AND "goalId"<>'' GROUP BY "goalId" ORDER BY MAX("createdAt") DESC LIMIT ?`,[limit])).map(row=>({goalId:String(value(row,"goalId")),logCount:Number(value(row,"logCount")),lastAt:normalizeLlmLogDate(value(row,"lastAt"))}))}
  async findGoals(ids:readonly string[]){if(ids.length===0)return[];return rows(await this.exec(`SELECT "id","title" FROM ${table(this.em,"LearningGoal")} WHERE "id" IN (${ids.map(()=>"?").join(",")})`,[...ids])).map(row=>({id:String(value(row,"id")),title:String(value(row,"title"))}))}
  async findGoal(id:string){const row=rows(await this.exec(`SELECT "id","title" FROM ${table(this.em,"LearningGoal")} WHERE "id"=? LIMIT 1`,[id]))[0];return row?{id:String(value(row,"id")),title:String(value(row,"title"))}:null}
  async listCreditUsage(logIds:readonly string[]){if(logIds.length===0)return[];return rows(await this.exec(`SELECT "llmRequestLogId","amount" FROM ${table(this.em,"CreditLedgerEntry")} WHERE "llmRequestLogId" IN (${logIds.map(()=>"?").join(",")}) AND "type"='consume' AND "source"='llm'`,[...logIds])).map(row=>({llmRequestLogId:value(row,"llmRequestLogId")==null?null:String(value(row,"llmRequestLogId")),amount:Number(value(row,"amount"))}))}
  async summarizeLocalTokenUsage(days:number){
    const safeDays=Math.max(1,Math.min(3660,Math.trunc(days)||30));
    const cutoff=new Date(Date.now()-(safeDays-1)*86_400_000);cutoff.setHours(0,0,0,0);const cutoffDay=`${cutoff.getFullYear()}-${String(cutoff.getMonth()+1).padStart(2,"0")}-${String(cutoff.getDate()).padStart(2,"0")}`;
    const measures=`SUM("requestCount") AS "requestCount",SUM("requestCount") AS "usageRequestCount",SUM("inputTokens") AS "inputTokens",SUM("cachedInputTokens") AS "cachedInputTokens",SUM("uncachedInputTokens") AS "uncachedInputTokens",SUM("unclassifiedInputTokens") AS "unclassifiedInputTokens",SUM("outputTokens") AS "outputTokens",SUM("cacheMeasuredRequestCount") AS "cacheMeasuredRequestCount"`;
    const normalize=(row:Row)=>Object.fromEntries(Object.entries(row).map(([key,item])=>[key,["provider","model","day"].includes(key)?String(item):Number(item??0)]));
    const models=rows(await this.exec(`SELECT "provider","model",${measures} FROM ${table(this.em,"LocalTokenUsageDaily")} WHERE "day">=? GROUP BY "provider","model" ORDER BY SUM("inputTokens"+"outputTokens") DESC`,[cutoffDay])).map(normalize);
    const daily=rows(await this.exec(`SELECT "day","provider","model",${measures} FROM ${table(this.em,"LocalTokenUsageDaily")} WHERE "day">=? GROUP BY "day","provider","model" ORDER BY "day" DESC,"provider","model"`,[cutoffDay])).map(normalize);
    const pricing=rows(await this.exec(`SELECT "provider","model","uncachedInputUsdPerMillion","cachedInputUsdPerMillion","outputUsdPerMillion","updatedAt" FROM ${table(this.em,"LocalModelPricing")} ORDER BY "provider","model"`)).map(row=>({...normalize(row),updatedAt:String(value(row,"updatedAt"))}));
    return {models,daily,pricing};
  }
  async upsertLocalModelPricing(input:{provider:string;model:string;uncachedInputUsdPerMillion:number;cachedInputUsdPerMillion:number;outputUsdPerMillion:number}){
    await this.exec(`INSERT INTO ${table(this.em,"LocalModelPricing")} ("provider","model","uncachedInputUsdPerMillion","cachedInputUsdPerMillion","outputUsdPerMillion","updatedAt") VALUES (?,?,?,?,?,?) ON CONFLICT("provider","model") DO UPDATE SET "uncachedInputUsdPerMillion"=excluded."uncachedInputUsdPerMillion","cachedInputUsdPerMillion"=excluded."cachedInputUsdPerMillion","outputUsdPerMillion"=excluded."outputUsdPerMillion","updatedAt"=excluded."updatedAt"`,[input.provider,input.model,input.uncachedInputUsdPerMillion,input.cachedInputUsdPerMillion,input.outputUsdPerMillion,new Date()]);
  }
  async deleteLocalModelPricing(provider:string,model:string){await this.exec(`DELETE FROM ${table(this.em,"LocalModelPricing")} WHERE "provider"=? AND "model"=?`,[provider,model])}
}
