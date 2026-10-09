import { CourseSourceRepository } from "../../../../../../persistence/sqlite/course-source.repository.ts";
import type { EntityManager } from "@mikro-orm/core";
const { DatabaseSync } = require("node:sqlite");

it("reads a real SQLite publication without writes, isolates owners, and preserves old accepted bodies", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE LearningGoal(id TEXT, userId TEXT, title TEXT, goalKind TEXT, contentLanguage TEXT);
      CREATE TABLE LearningModule(id TEXT, orderIndex INTEGER);
      CREATE TABLE LearningUnit(id TEXT, goalId TEXT, moduleId TEXT, orderIndex INTEGER, title TEXT, unitKind TEXT, contentSummary TEXT, contentRevision INTEGER);
      CREATE TABLE UnitSessionState(unitId TEXT, sq3rData TEXT);
      CREATE TABLE LearningMaterial(unitId TEXT, introduction TEXT, sections TEXT, keyTakeaways TEXT);
      CREATE TABLE MainCourseSection(id TEXT, unitId TEXT, orderIndex INTEGER, title TEXT, contentSummary TEXT, contentKind TEXT, generationStatus TEXT, assessmentAfter INTEGER, testGenerationStatus TEXT, contentRevision INTEGER, derivationFormat TEXT);
      CREATE TABLE AiGenerationRun(scopeId TEXT, operation TEXT, status TEXT);
      CREATE TABLE UnitSectionMaterial(id TEXT, sectionId TEXT, introduction TEXT, blocks TEXT, keyTakeaways TEXT);
      CREATE TABLE UnitSectionDerivation(sectionId TEXT, documentJson TEXT);
      CREATE TABLE UnitSectionTeachingDerivation(sectionId TEXT, documentJson TEXT, derivedJson TEXT, parserVersion TEXT, analyzerVersion TEXT, matcherVersion TEXT, compilerVersion TEXT);
      CREATE TABLE UnitLearningTarget(unitId TEXT, learningTargetId TEXT, orderIndex INTEGER, localRef TEXT, role TEXT, required INTEGER, weight REAL);
      CREATE TABLE LearningTarget(id TEXT, goalId TEXT, title TEXT, explanation TEXT, learningObjective TEXT, assessmentCriteria TEXT, language TEXT, definitionVersion INTEGER);
      INSERT INTO LearningGoal VALUES ('goal','owner','原始目标','full','zh');
      INSERT INTO LearningModule VALUES ('module',2);
      INSERT INTO LearningUnit VALUES ('unit','goal','module',3,'完整单元','overview','原始范围',7);
      INSERT INTO UnitSessionState VALUES ('unit','{}');
      INSERT INTO MainCourseSection VALUES ('second','unit',1,'第二节','后半内容','standard','pending',1,'pending',0,NULL);
      INSERT INTO MainCourseSection VALUES ('first','unit',0,'第一节','完整推导','formal_derivation','running',1,'pending',3,'teaching_v1');
      INSERT INTO UnitSectionMaterial VALUES ('material','first','原始引言','[{"type":"paragraph","text":"原始讲解","cue":{"id":"kept","targetIds":["teaching:figure:focus:item"]}}]','["原始结论"]');
      INSERT INTO UnitSectionTeachingDerivation VALUES ('first','{"status":"complete","steps":[{"id":"original-step","narration":"完整原始推导"}]}','{"targets":[{"id":"original-target"}]}','p1','a1','m1','c1');`);
    const statements: string[] = [];
    const execute = async (sql: string, params: unknown[] = []) => { statements.push(sql); return db.prepare(sql).all(...params); };
    const em = {config: {getSchema: () => undefined}, getConnection: () => ({execute}), getTransactionContext: () => undefined} as unknown as EntityManager;
    const root = {fork: () => ({...em, transactional: async (fn: (tx: EntityManager) => unknown) => {
      db.exec("BEGIN DEFERRED"); try { const value = await fn(em); db.exec("COMMIT"); return value; }
      catch(error) { db.exec("ROLLBACK"); throw error; }
    }})} as unknown as EntityManager;
    const source = new CourseSourceRepository(root, async () => null);
    expect(await source.readUnit({workspaceId: "workspace", ownerId: "other", unitId: "unit"})).toBeNull();
    const snapshot = (await source.readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"}))!;
    expect(snapshot.sections.map(section => section.id)).toEqual(["first", "second"]);
    expect(snapshot.sections.map(section => section.availability)).toEqual(["published", "missing"]);
    expect(snapshot.sections[0]!.teachingDerivationDocument).toEqual({status: "complete", steps: [{id: "original-step", narration: "完整原始推导"}]});
    expect(snapshot.preview).toEqual({status: "not-required", data: null});
    db.exec(`UPDATE LearningUnit SET unitKind='lesson'; UPDATE UnitSessionState SET sq3rData='{"survey":{"outline":["provisional"]}}';
      INSERT INTO AiGenerationRun VALUES ('unit','unit.generate_sq','running');`);
    expect((await source.readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"}))?.preview.status).toBe("ready");
    db.exec("DELETE FROM UnitSectionMaterial; DELETE FROM UnitSectionTeachingDerivation;");
    expect((await source.readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"}))?.preview.status).toBe("pending");
    db.exec("DELETE FROM AiGenerationRun; UPDATE LearningUnit SET unitKind='overview'; UPDATE UnitSessionState SET sq3rData='{}';");
    expect(statements.every(sql => sql.startsWith("SELECT"))).toBe(true);
    expect((await source.readCatalog({workspaceId: "workspace", ownerId: "other"}))).toEqual([]);
    db.exec("UPDATE MainCourseSection SET generationStatus='ready'; UPDATE LearningUnit SET contentRevision=8;");
    const updated = await source.readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"});
    expect(updated?.contentHash).not.toBe(snapshot.contentHash);
    expect(snapshot.sections[0]!.material?.introduction).toBe("原始引言");
  } finally { db.close(); }
});
