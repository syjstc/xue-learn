import type { EntityManager } from "@mikro-orm/core";
import type { LearningSystemPersistenceClient } from "@xue-learn/core/source/libs/server/src/learning-systems/persistence-client.ts";
import { referenceDateValue } from "./date-value.ts";

type Row=Record<string,any>;
const rows=(result:unknown):Row[]=>Array.isArray(result)?result as Row[]:result&&typeof result==="object"&&"rows" in result&&Array.isArray((result as any).rows)?(result as any).rows:[];
const table=(em:EntityManager,name:string)=>{const schema=em.schema??em.config?.getSchema();const q=`"${name.replaceAll('"','""')}"`;return schema?`"${schema.replaceAll('"','""')}".${q}`:q;};
const dates=(row:Row|undefined)=>{if(!row)return row;for(const [key,value] of Object.entries(row))if(key.endsWith("At")&&value!=null&&!(value instanceof Date))row[key]=referenceDateValue(value,key);return row;};
const json=(value:unknown)=>{if(typeof value!=="string")return value;try{return JSON.parse(value);}catch{return value;}};
const bool=(value:unknown)=>value===true||value===1||value==="1"||value==="true";

export function createLearningSystemPersistenceClient(em:EntityManager):LearningSystemPersistenceClient{
  const execute=(sql:string,params:unknown[]=[])=>em.getConnection().execute(sql,params,undefined,em.getTransactionContext());
  const goal=async(id:string)=>dates(rows(await execute(`SELECT * FROM ${table(em,"LearningGoal")} WHERE "id"=? LIMIT 1`,[id]))[0]);
  const enrichUnit=async(row:Row|undefined)=>{if(!row)return null;dates(row);row.goal=await goal(String(row.goalId));row.sessionState=dates(rows(await execute(`SELECT * FROM ${table(em,"UnitSessionState")} WHERE "unitId"=? LIMIT 1`,[row.id]))[0])??null;const material=dates(rows(await execute(`SELECT * FROM ${table(em,"LearningMaterial")} WHERE "unitId"=? LIMIT 1`,[row.id]))[0]);if(material){material.sections=json(material.sections);material.keyTakeaways=json(material.keyTakeaways);material.contextSources=json(material.contextSources);}row.learningMaterial=material??null;return row;};
  const goalWhere=(where:any)=>{const clauses:string[]=[],params:unknown[]=[];if(where?.id){clauses.push(`"id"=?`);params.push(where.id);}if(where?.userId){clauses.push(`"userId"=?`);params.push(where.userId);}if(where?.status){clauses.push(`"status"=?`);params.push(where.status);}if(where?.title?.contains){clauses.push(`LOWER("title") LIKE LOWER(?)`);params.push(`%${where.title.contains}%`);}return{clauses,params};};
  return{
    priorTeaching: { findMany: async ({ userId, unitId }) => rows(await execute(`
      SELECT p."title", sm."blocks", sm."keyTakeaways", p."contentRevision"
      FROM ${table(em,"LearningUnit")} current_unit
      JOIN ${table(em,"LearningGoal")} g ON g."id" = current_unit."goalId" AND g."userId" = ?
      JOIN ${table(em,"LearningModule")} current_module ON current_module."id" = current_unit."moduleId"
      JOIN ${table(em,"LearningModule")} pm ON pm."goalId" = g."id"
      JOIN ${table(em,"LearningUnit")} p ON p."moduleId" = pm."id" AND p."goalId" = g."id"
      JOIN ${table(em,"MainCourseSection")} ps ON ps."unitId" = p."id" AND ps."generationStatus" = 'ready'
      JOIN ${table(em,"UnitSectionMaterial")} sm ON sm."sectionId" = ps."id"
      WHERE current_unit."id" = ? AND (pm."orderIndex" < current_module."orderIndex"
        OR (pm."id" = current_module."id" AND p."orderIndex" < current_unit."orderIndex"))
      ORDER BY pm."orderIndex" DESC, p."orderIndex" DESC, ps."orderIndex" DESC LIMIT 24
    `, [userId, unitId])).reverse().map(row => ({ title: String(row.title), blocks: json(row.blocks), keyTakeaways: json(row.keyTakeaways), contentRevision: Number(row.contentRevision ?? 0) })) },
    learningSystemAvailability:{findUnique:async(raw)=>{const id=(raw as any).where.capabilityId;return dates(rows(await execute(`SELECT * FROM ${table(em,"LearningSystemAvailability")} WHERE "capabilityId"=? LIMIT 1`,[id]))[0])??null;}},
    goalLearningSystemBinding:{findFirst:async(raw)=>{const w=(raw as any).where;return dates(rows(await execute(`SELECT b.* FROM ${table(em,"GoalLearningSystemBinding")} b JOIN ${table(em,"LearningGoal")} g ON g."id"=b."goalId" WHERE b."goalId"=? AND b."capabilityId"=? AND g."userId"=? LIMIT 1`,[w.goalId,w.capabilityId,w.goal.userId]))[0])??null;}},
    learningGoal:{
      findFirst:async(raw)=>{const args=raw as any,{clauses,params}=goalWhere(args.where);return dates(rows(await execute(`SELECT * FROM ${table(em,"LearningGoal")} ${clauses.length?`WHERE ${clauses.join(" AND ")}`:""} ORDER BY "updatedAt" DESC,"id" DESC LIMIT 1`,params))[0])??null;},
      findUnique:async(raw)=>goal((raw as any).where.id),
      findMany:async(raw)=>{const args=raw as any,{clauses,params}=goalWhere(args.where);const limit=Math.max(1,Number(args.take??100));return rows(await execute(`SELECT * FROM ${table(em,"LearningGoal")} ${clauses.length?`WHERE ${clauses.join(" AND ")}`:""} ORDER BY "updatedAt" DESC,"id" DESC LIMIT ${limit}`,params)).map(row=>dates(row)!);},
    },
    learningUnit:{
      findFirst:async(raw)=>{const w=(raw as any).where,clauses:string[]=[],params:unknown[]=[];if(w.id){clauses.push(`u."id"=?`);params.push(w.id);}const owner=w.goal?.userId;if(owner){clauses.push(`g."userId"=?`);params.push(owner);}if(w.goal?.id){clauses.push(`g."id"=?`);params.push(w.goal.id);}const row=rows(await execute(`SELECT u.* FROM ${table(em,"LearningUnit")} u JOIN ${table(em,"LearningGoal")} g ON g."id"=u."goalId" WHERE ${clauses.join(" AND ")} LIMIT 1`,params))[0];return enrichUnit(row);},
      findMany:async(raw)=>{const args=raw as any,w=args.where??{},clauses:string[]=[],params:unknown[]=[];if(w.goalId){clauses.push(`u."goalId"=?`);params.push(w.goalId);}if(w.goal?.userId){clauses.push(`g."userId"=?`);params.push(w.goal.userId);}if(w.goal?.id){clauses.push(`g."id"=?`);params.push(w.goal.id);}if(w.status){clauses.push(`u."status"=?`);params.push(w.status);}if(w.title?.contains){clauses.push(`LOWER(u."title") LIKE LOWER(?)`);params.push(`%${w.title.contains}%`);}const result=rows(await execute(`SELECT u.* FROM ${table(em,"LearningUnit")} u JOIN ${table(em,"LearningGoal")} g ON g."id"=u."goalId" ${clauses.length?`WHERE ${clauses.join(" AND ")}`:""} ORDER BY u."orderIndex",u."id" LIMIT ${Math.max(1,Number(args.take??100))}`,params));return Promise.all(result.map(enrichUnit));},
    },
    learningModule:{
      findMany:async(raw)=>rows(await execute(`SELECT * FROM ${table(em,"LearningModule")} WHERE "goalId"=? ORDER BY "orderIndex","id" LIMIT ${Math.max(1,Number((raw as any).take??20))}`,[(raw as any).where.goalId])).map(row=>dates(row)!),
      findFirst:async(raw)=>{
        const w=(raw as any).where??{};
        const clauses:string[]=[],params:unknown[]=[];
        if(w.id){clauses.push(`m."id"=?`);params.push(w.id);}
        if(w.goalId){clauses.push(`m."goalId"=?`);params.push(w.goalId);}
        const owner=w.goal?.userId;
        if(owner){clauses.push(`g."userId"=?`);params.push(owner);}
        const row=rows(await execute(`SELECT m.* FROM ${table(em,"LearningModule")} m JOIN ${table(em,"LearningGoal")} g ON g."id"=m."goalId" ${clauses.length?`WHERE ${clauses.join(" AND ")}`:""} LIMIT 1`,params))[0];
        if(!row)return null;
        dates(row);
        row.goal=await goal(String(row.goalId));
        return row;
      },
    },
    unitSessionState:{
      findFirst:async(raw)=>{const w=(raw as any).where,params:unknown[]=[w.unit.goal.userId],extra=w.unit.goal.id?` AND g."id"=?`:"";if(w.unit.goal.id)params.push(w.unit.goal.id);return dates(rows(await execute(`SELECT s.* FROM ${table(em,"UnitSessionState")} s JOIN ${table(em,"LearningUnit")} u ON u."id"=s."unitId" JOIN ${table(em,"LearningGoal")} g ON g."id"=u."goalId" WHERE g."userId"=?${extra} ORDER BY s."updatedAt" DESC LIMIT 1`,params))[0])??null;},
      findMany:async(raw)=>{const args=raw as any,userId=args.where.unit.goal.userId,result=rows(await execute(`SELECT s.*,u."id" AS "unitJoinId",u."title" AS "unitTitle",u."status" AS "unitStatus",u."goalId",g."title" AS "goalTitle" FROM ${table(em,"UnitSessionState")} s JOIN ${table(em,"LearningUnit")} u ON u."id"=s."unitId" JOIN ${table(em,"LearningGoal")} g ON g."id"=u."goalId" WHERE g."userId"=? ORDER BY s."updatedAt" DESC LIMIT ${Math.max(1,Number(args.take??20))}`,[userId]));return result.map(row=>({...dates(row),unit:{id:row.unitJoinId,title:row.unitTitle,status:row.unitStatus,goalId:row.goalId,goal:{title:row.goalTitle}}}));},
    },
    goalCreationSession:{findUnique:async(raw)=>{const slot=(raw as any).where.activeSlot,row=dates(rows(await execute(`SELECT * FROM ${table(em,"GoalCreationSession")} WHERE "activeSlot"=? LIMIT 1`,[slot]))[0]);if(!row)return null;row.goal=row.goalId?await goal(String(row.goalId)):null;return row;}},
    taskAttempt:{findMany:async(raw)=>{const args=raw as any,w=args.where,clauses=[`a."userId"=?`],params:unknown[]=[w.userId];if(w.unitId){clauses.push(`a."unitId"=?`);params.push(w.unitId);}if(w.task?.goalId){clauses.push(`t."goalId"=?`);params.push(w.task.goalId);}const attempts=rows(await execute(`SELECT a.*,t."taskType",t."goalId" AS "taskGoalId" FROM ${table(em,"TaskAttempt")} a JOIN ${table(em,"LearningTask")} t ON t."id"=a."taskId" WHERE ${clauses.join(" AND ")} ORDER BY a."startedAt" DESC,a."id" DESC LIMIT 10`,params));for(const attempt of attempts){dates(attempt);attempt.task={taskType:attempt.taskType,goalId:attempt.taskGoalId};attempt.observations=rows(await execute(`SELECT "dimension","outcome","score","observedAt" FROM ${table(em,"TaskObservation")} WHERE "attemptId"=? ORDER BY "observedAt" DESC,"id" DESC LIMIT 12`,[attempt.id])).map(row=>dates(row)!);}return attempts;}},
    unitScenarioTheater:{findUnique:async(raw)=>dates(rows(await execute(`SELECT * FROM ${table(em,"UnitScenarioTheater")} WHERE "unitId"=? LIMIT 1`,[(raw as any).where.unitId]))[0])??null},
    scenarioTheaterRun:{findFirst:async(raw)=>{const w=(raw as any).where;return dates(rows(await execute(`SELECT * FROM ${table(em,"ScenarioTheaterRun")} WHERE "userId"=? AND "unitId"=? ORDER BY "updatedAt" DESC LIMIT 1`,[w.userId,w.unitId]))[0])??null;}},
    globalGenerationSettings:{findUnique:async()=>{const row=rows(await execute(`SELECT * FROM ${table(em,"GlobalGenerationSettings")} WHERE "id"='global' LIMIT 1`))[0];return row?{...dates(row),deepPlanningResearchConcurrency:Number(row.deepPlanningResearchConcurrency??2),searchEnabled:row.searchEnabled==null?true:bool(row.searchEnabled),disabledMaterialComponentTypes:json(row.disabledMaterialComponentTypes)}:null;}},
  };
}
