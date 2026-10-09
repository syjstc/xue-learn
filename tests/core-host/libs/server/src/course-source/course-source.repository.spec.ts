import { CourseSourceRepository, courseSourceContentHash } from "../../../../../../persistence/sqlite/course-source.repository.ts";
import type { EntityManager } from "@mikro-orm/core";
import { createHash } from "node:crypto";

function fixture() {
  const header = {id: "unit", goalId: "goal", moduleId: "module", orderIndex: 2, title: "完整课程", unitKind: "lesson", contentSummary: "原始范围", contentRevision: 7,
    goalTitle: "目标", goalKind: "full", contentLanguage: "zh", moduleOrderIndex: 1,
    sq3rData: JSON.stringify({survey: {outline: ["全部内容"]}, questions: [{text: "为何成立？"}], answers: ["private answer"], graphState: {private: true}}),
    legacyIntroduction: null, legacySections: null, legacyKeyTakeaways: null};
  const cues = Array.from({length: 1200}, (_, i) => ({id: `cue-${i}`, text: `完整讲解 ${i}`, targetIds: [`teaching:figure:focus:${i}`]}));
  const sections = [{id: "s1", orderIndex: 0, title: "原始小节", contentSummary: "小节范围", contentKind: "formal_derivation", generationStatus: "running", contentRevision: 4,
    derivationFormat: "teaching_v1", materialId: "m1", introduction: "{{learnerName}}，保留原文。", blocks: JSON.stringify([{type: "paragraph", text: "完整原文", cues},
      {type: "image", src: "/api/units/unit/images/ill-0-abc.png?aigc=v1"}]), keyTakeaways: '["原始结论"]', documentJson: null,
    teachingDocumentJson: JSON.stringify({status: "complete", presentationVersion: "teaching.v1", steps: cues}), derivedJson: '{"kept":true}', parserVersion: "p1", analyzerVersion: "a1", matcherVersion: "m1", compilerVersion: "c1"}];
  const execute = jest.fn(async (sql: string) => sql.includes('FROM "LearningUnit"') ? [header] : sql.includes('FROM "MainCourseSection"') ? sections : [{id: "target", title: "学习目标", assessmentCriteria: '["标准"]'}]);
  const em = {schema: undefined, config: {getSchema: () => undefined}, getConnection: () => ({execute}), getTransactionContext: () => "transaction"} as unknown as EntityManager;
  const transactional = jest.fn(async fn => fn(em));
  const root = {fork: () => ({transactional})} as unknown as EntityManager;
  const bytes = Buffer.from("immutable image fixture");
  return {header, sections, cues, bytes, execute, transactional, repository: new CourseSourceRepository(root, async () => ({data: bytes, mimeType: "image/png"}))};
}
it("reads complete published evidence in order during replacement and hashes only course facts", async () => {
  const f = fixture();
  const source = (await f.repository.readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"}))!;
  expect(source.sections[0]!.teachingDerivationDocument).toEqual({status: "complete", presentationVersion: "teaching.v1", steps: f.cues});
  expect(JSON.stringify(source)).not.toContain("private answer");
  expect(source.sections[0]!.material?.introduction).toContain("{{learnerName}}");
  expect(source.sections[0]!.availability).toBe("published");
  expect(source.assets[0]!.sha256).toBe(createHash("sha256").update(f.bytes).digest("hex"));
  expect(f.transactional).toHaveBeenCalledTimes(2);
  expect(f.execute.mock.calls[0]![1]).toEqual(["unit", "owner"]);
  f.sections[0]!.generationStatus = "ready";
  const reread = (await f.repository.readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"}))!;
  expect(reread.contentHash).toBe(source.contentHash);
  expect(reread.snapshotId).toBe(source.snapshotId);
  const asset = await f.repository.readAsset({ownerId: "owner", unitId: "unit", resourceId: source.assets[0]!.resourceId, sha256: source.assets[0]!.sha256!});
  expect(asset?.data).toEqual(f.bytes);
  await expect(f.repository.readAsset({ownerId: "owner", unitId: "unit", resourceId: source.assets[0]!.resourceId, sha256: "a".repeat(64)})).rejects.toThrow("ASSET_CHANGED");
});
it("marks overview preview not-required without synthesizing Survey or requiring tests", async () => {
  const f = fixture(); f.header.unitKind = "overview"; f.header.sq3rData = "{}";
  const source = await f.repository.readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"});
  expect(source?.preview).toEqual({status: "not-required", data: null});
  expect(f.execute.mock.calls.every(([sql]) => !sql.includes('Quiz') && !sql.includes('Progress'))).toBe(true);
});
it("fails actionably on concurrent publication and capacity instead of returning mixed/truncated evidence", async () => {
  const f = fixture(); let reads = 0;
  const root = {fork: () => ({transactional: async (fn: (em: unknown) => unknown) => {
    const em = {config: {getSchema: () => undefined}, getTransactionContext: () => "tx", getConnection: () => ({execute: async (sql: string) => {
      if (sql.includes('FROM "LearningUnit"')) return [{...f.header, contentRevision: ++reads > 1 ? 8 : 7}];
      return sql.includes('FROM "MainCourseSection"') ? f.sections : [];
    }})}; return fn(em);
  }})} as unknown as EntityManager;
  await expect(new CourseSourceRepository(root, async () => ({data: f.bytes, mimeType: "image/png"})).readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"})).rejects.toThrow("COURSE_SOURCE_CHANGED");
  const tiny = new CourseSourceRepository({fork: () => ({transactional: f.transactional})} as unknown as EntityManager, async () => null, () => new Date(), 100);
  await expect(tiny.readUnit({workspaceId: "workspace", ownerId: "owner", unitId: "unit"})).rejects.toThrow("No content was truncated");
});
it("rechecks asset ownership after asynchronous raw pixels are read", async () => {
  const f=fixture(); let reads=0;
  const root={fork:()=>({transactional:async(fn:(em:unknown)=>unknown)=>fn({config:{getSchema:()=>undefined},getTransactionContext:()=>"tx",getConnection:()=>({execute:async(sql:string)=>{
    if(sql.includes('FROM "LearningUnit"'))return ++reads===1?[f.header]:[];
    return sql.includes('FROM "MainCourseSection"')?f.sections:[];
  }})})})} as unknown as EntityManager;
  const repository=new CourseSourceRepository(root,async()=>({data:f.bytes,mimeType:"image/png"}));
  await expect(repository.readAsset({ownerId:"owner",unitId:"unit",resourceId:"unit-image:ill-0-abc",sha256:createHash("sha256").update(f.bytes).digest("hex")})).rejects.toThrow("ownership or published reference changed");
});
