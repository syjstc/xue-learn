import type {ReferencePersistenceRuntime} from "./reference/runtime.ts";
jest.mock("@xue-learn/core/source/libs/server/src/sections/index.ts",()=>({completeUnitSection:jest.fn(async()=>({status:"completed"})),getUnitSectionContent:jest.fn(async()=>({material:{blocks:[{checkId:"check"}]}})),getAggregatedUnitMaterial:jest.fn(async()=>({blocks:[{checkId:"check"}]})),getUnitSectionManifest:jest.fn(async()=>[])}));
jest.mock("@xue-learn/core/source/libs/server/src/assessment/index.ts",()=>({publishedMaterialCheckDefinitions:jest.fn((material:{blocks:unknown[]})=>material.blocks),submitSectionMiniTestAnswers:jest.fn(async()=>({score:1}))}));
import {createWorkspaceLearningPort} from "./workspace-learning.ts";
import {completeUnitSection} from "@xue-learn/core/source/libs/server/src/sections/index.ts";
import {submitSectionMiniTestAnswers} from "@xue-learn/core/source/libs/server/src/assessment/index.ts";
const {DatabaseSync}=require("node:sqlite");
it("fences owner/unit/section versions before invoking ordinary Core learning commands",async()=>{
 const db=new DatabaseSync(":memory:");db.exec(`CREATE TABLE LearningGoal(id TEXT,userId TEXT);CREATE TABLE LearningUnit(id TEXT,goalId TEXT,contentRevision INTEGER,status TEXT,completedAt TEXT);CREATE TABLE MainCourseSection(id TEXT,unitId TEXT,contentRevision INTEGER);
 INSERT INTO LearningGoal VALUES('goal','owner');INSERT INTO LearningUnit VALUES('unit','goal',7,'available',NULL);INSERT INTO MainCourseSection VALUES('section','unit',3);`);
 const em={getContext:()=>em,getTransactionContext:()=>undefined,getConnection:()=>({execute:async(sql:string,params:unknown[])=>db.prepare(sql).all(...params)})};
 const repositories={unitSectionProgress:{completeOwned:jest.fn()},materialCheckCompletion:{complete:jest.fn()},assessmentTarget:{findForUnit:jest.fn(async()=>[])}};
 const runtime={orm:{em},repositories,runInTransaction:async(fn:(ports:unknown)=>unknown)=>{db.exec("BEGIN IMMEDIATE");try{const value=await fn(repositories);db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}}} as unknown as ReferencePersistenceRuntime;
 const port=createWorkspaceLearningPort(runtime),input={ownerId:"owner",unitId:"unit",sectionId:"section",expectedContentRevision:7,expectedSectionRevision:3};
 try{
  await expect(port.command({...input,ownerId:"other",action:"complete"})).rejects.toThrow("not found");
  await expect(port.command({...input,expectedSectionRevision:2,action:"complete"})).rejects.toThrow("CONTENT_CHANGED");
  expect(completeUnitSection).not.toHaveBeenCalled();
  await port.command({...input,action:"complete"});
  expect(completeUnitSection).toHaveBeenCalledWith(expect.objectContaining({userId:"owner",unitId:"unit",sectionId:"section",sectionProgress:repositories.unitSectionProgress}));
  await port.command({...input,action:"answers",answers:{check:0}});
  expect(submitSectionMiniTestAnswers).toHaveBeenCalledWith(expect.objectContaining({userId:"owner",answers:{check:0},expectedUnitRevision:7,expectedSectionRevision:3}));
  expect(db.prepare('SELECT status FROM LearningUnit').get().status).toBe('available');
 }finally{db.close();}
});
