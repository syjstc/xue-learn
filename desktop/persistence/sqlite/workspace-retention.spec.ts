import {workspaceBackgroundTaskCount} from "./workspace-retention.ts";
import type {EntityManager} from "@mikro-orm/core";
const {DatabaseSync}=require("node:sqlite");
it("retains a queued accepted job before an AI run exists",async()=>{
 const db=new DatabaseSync(":memory:");
 db.exec(`CREATE TABLE AiGenerationRun(status TEXT);CREATE TABLE LlmRequestLog(status TEXT);CREATE TABLE EventOutbox(publishedAt TEXT,deadLetteredAt TEXT);CREATE TABLE DomainEventOutbox(fanoutCompletedAt TEXT);CREATE TABLE DomainEventDelivery(status TEXT,deadLetteredAt TEXT);CREATE TABLE ModuleStructureDraft(status TEXT);CREATE TABLE LearningModule(generationStatus TEXT,entryFoundationStatus TEXT);CREATE TABLE UnitSection(generationStatus TEXT,testGenerationStatus TEXT);CREATE TABLE GoalCreationSession(status TEXT,currentRunId TEXT);CREATE TABLE DeepPlanningResearchLease(status TEXT,releasedAt TEXT);CREATE TABLE FormalDerivationRun(status TEXT);CREATE TABLE TeachingDerivationRun(status TEXT);CREATE TABLE LocalEmbeddingIndexState(status TEXT);`);
 const em={getTransactionContext:()=>undefined,getConnection:()=>({execute:async(sql:string)=>db.prepare(sql).all()})} as unknown as EntityManager;
 try{expect(await workspaceBackgroundTaskCount(em)).toBe(0);db.exec("INSERT INTO EventOutbox VALUES(NULL,NULL)");expect(await workspaceBackgroundTaskCount(em)).toBe(1);
 db.exec("UPDATE EventOutbox SET publishedAt='done';INSERT INTO ModuleStructureDraft VALUES('queued')");expect(await workspaceBackgroundTaskCount(em)).toBe(1);
 db.exec("UPDATE ModuleStructureDraft SET status='failed'");expect(await workspaceBackgroundTaskCount(em)).toBe(0);
 db.exec("INSERT INTO LocalEmbeddingIndexState VALUES('queued')");expect(await workspaceBackgroundTaskCount(em)).toBe(1);
 db.exec("UPDATE LocalEmbeddingIndexState SET status='building'");expect(await workspaceBackgroundTaskCount(em)).toBe(1);
 db.exec("UPDATE LocalEmbeddingIndexState SET status='published'");expect(await workspaceBackgroundTaskCount(em)).toBe(0);}finally{db.close();}
});
