import {MikroOrmMaterialCheckCompletionRuntimeAdapter} from "./reference/material-check-completion.runtime.ts";
import type { EntityManager } from "@mikro-orm/core";
import type { WorkspaceLearningPort } from "@xue-learn/core/domain/persistence/workspace-learning-port";
import type { ReferencePersistenceRuntime } from "./reference/runtime.ts";
import { getUnitSectionContent, getUnitSectionManifest, getAggregatedUnitMaterial, completeUnitSection } from "@xue-learn/core/server/sections";
import { publishedMaterialCheckDefinitions, submitSectionMiniTestAnswers } from "@xue-learn/core/server/assessment";
async function query(em: EntityManager, sql: string, params: unknown[] = []) {
  return await em.getConnection().execute(sql, params, undefined, em.getTransactionContext()) as Record<string, unknown>[];
}
async function ownedUnit(em: EntityManager, ownerId: string, unitId: string) {
  const unit = (await query(em, `SELECT u."id",u."goalId",u."contentRevision",u."status",u."completedAt" FROM "LearningUnit" u JOIN "LearningGoal" g ON g."id"=u."goalId" WHERE u."id"=? AND g."userId"=?`, [unitId,ownerId]))[0];
  if(!unit)throw Object.assign(new Error("Learning unit not found"),{status:404});
  return unit;
}
/** Separate owned assessment definitions; commands use ordinary Core grading and completion. */
export function createWorkspaceLearningPort(runtime: ReferencePersistenceRuntime): WorkspaceLearningPort {
 return {
  async assessments(input){
   return runtime.runInTransaction(async ()=>{
    const em=runtime.orm.em.getContext(false);
    const unit=await ownedUnit(em,input.ownerId,input.unitId);
    const sections=await query(em,`SELECT s."id",s."orderIndex",s."contentRevision",s."testGenerationStatus",m."blocks" FROM "MainCourseSection" s LEFT JOIN "UnitSectionMaterial" m ON m."sectionId"=s."id" WHERE s."unitId"=? ORDER BY s."orderIndex",s."id"`,[input.unitId]);
    const quizzes=await query(em,`SELECT "id","purpose","questions" FROM "QuizSet" WHERE "unitId"=? ORDER BY "createdAt","id"`,[input.unitId]);
    return {contractVersion:"course-assessments.v1",unitId:input.unitId,contentRevision:Number(unit.contentRevision),
     sections:sections.map(section=>({sectionId:String(section.id),orderIndex:Number(section.orderIndex),contentRevision:Number(section.contentRevision),status:section.testGenerationStatus,
      definitions:publishedMaterialCheckDefinitions({blocks:section.blocks?JSON.parse(String(section.blocks)):[]} as never)})),
     quizzes:quizzes.map(quiz=>({id:String(quiz.id),purpose:quiz.purpose,questions:JSON.parse(String(quiz.questions))}))};
   });
  },
  async progress(input){
   const unit=await ownedUnit(runtime.orm.em,input.ownerId,input.unitId);
   return {unitId:input.unitId,contentRevision:Number(unit.contentRevision),status:unit.status,completedAt:unit.completedAt,sections:await getUnitSectionManifest(input.ownerId,input.unitId)};
  },
  async command(input){
   {
    const repositories=runtime.repositories;
    const materialChecks=new MikroOrmMaterialCheckCompletionRuntimeAdapter(runtime);
    // Business routines own their transactions. Expected revisions are checked
    // again inside their completion/evidence port's atomic commit.
    const em=runtime.orm.em.getContext(false);
    const unit=await ownedUnit(em,input.ownerId,input.unitId);
    const actualSectionId=input.sectionId.replace(/^mini-test:/,"");
    const section=(await query(em,`SELECT "id","contentRevision" FROM "MainCourseSection" WHERE "id"=? AND "unitId"=?`,[actualSectionId,input.unitId]))[0];
    if(!section)throw Object.assign(new Error("Learning section not found"),{status:404});
    if(Number(unit.contentRevision)!==input.expectedContentRevision||Number(section.contentRevision)!==input.expectedSectionRevision)
     throw Object.assign(new Error("LEARNING_CONTENT_CHANGED: Read current unit and section before submitting"),{status:409});
    if(input.action==="complete")return completeUnitSection({userId:input.ownerId,unitId:input.unitId,sectionId:input.sectionId,
     sectionProgress:repositories.unitSectionProgress,materialCheckCompletion:materialChecks,expectedUnitRevision:input.expectedContentRevision,expectedSectionRevision:input.expectedSectionRevision});
    const saved=await getUnitSectionContent(input.ownerId,input.unitId,`mini-test:${actualSectionId}`,input.expectedSectionRevision);
    if(!saved.material)throw Object.assign(new Error("Published section assessment is missing"),{status:409});
    const ids=new Set(publishedMaterialCheckDefinitions(saved.material).map(definition=>definition.checkId));
    const material=await getAggregatedUnitMaterial(input.unitId);
    if(!material)throw Object.assign(new Error("Published material is missing"),{status:409});
    const definitions=publishedMaterialCheckDefinitions(material).filter(definition=>ids.has(definition.checkId));
    return submitSectionMiniTestAnswers({userId:input.ownerId,goalId:String(unit.goalId),unitId:input.unitId,sectionId:`mini-test:${actualSectionId}`,
     definitions,answers:input.answers??{},material,targets:await repositories.assessmentTarget.findForUnit({userId:input.ownerId,unitId:input.unitId}),materialCheckCompletion:materialChecks,expectedUnitRevision:input.expectedContentRevision,expectedSectionRevision:input.expectedSectionRevision});
   }
  },
 };
}
