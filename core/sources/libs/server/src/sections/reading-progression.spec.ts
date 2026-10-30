import type {UnitSectionPlanRepository, UnitSectionProgressRepository} from "../../../domain/src/index.js";
import {configureReadingContext} from "../reading/context.js";
import {runWithUserId} from "../user-context.js";
import {completeUnitSection, configureUnitSectionPlanPersistence, generateUnitSectionMaterial, getAggregatedUnitMaterial, getUnitSectionContent} from "./index.js";
import {compileCourseMaterialInlineCheckArray} from "../llm/course-material-inline-checks.js";
import {buildMaterialCheckTaskDeclarations} from "../assessment/activities.js";

jest.mock("../llm/course-material-inline-checks.js", () => ({
  ...jest.requireActual("../llm/course-material-inline-checks.js"),
  planCourseMaterialInlineChecks: () => [{questionType: "mcq"}],
  compileCourseMaterialInlineCheckArray: jest.fn(),
}));
jest.mock("../content-verification/index.js", () => ({
  ...jest.requireActual("../content-verification/index.js"),
  verifyAndRepairMiniTest: async ({checks}: {checks: unknown}) => checks,
}));
jest.mock("../assessment/activities.js", () => ({
  ...jest.requireActual("../assessment/activities.js"),
  buildMaterialCheckTaskDeclarations: jest.fn(async () => []),
}));

const chapter = {
  id: "chapter", stableKey: "chapter", orderIndex: 0, title: "Equations", contentSummary: "Solve equations",
  requiredForCompletion: true, baseEstimatedMinutes: 5, generationStatus: "pending", generationError: "",
  testGenerationStatus: "pending", testGenerationError: "", contentRevision: 1, assessmentAfter: true,
  componentPlan: [], contentKind: "standard", progressStatus: "available", activeSeconds: 0,
  contentCompletedAt: null, hasSkipRequirements: false, skipRequirementsSatisfied: false,
};
const content = {sectionFound: true, contentRevision: 1, orderIndex: 0, contentKind: "standard",
  derivationFormat: null, material: null, derivationJson: null, teachingDerivationJson: null,
  teachingDerivationDerivedJson: null, priorMaterials: [], legacy: null};
const reading = JSON.stringify({blocks: [{type: "paragraph", text: "Subtract 1 on both sides."}]});
const check = {type: "check", checkId: "shared-check", questionType: "mcq", question: "x + 1 = 3. Find x.",
  options: ["1", "2"], correctIndex: 1, explanation: "Subtract 1.", primaryLearningTargetId: "lt_1",
  learningTargetIds: ["lt_1"], evidenceDimension: "understanding", criterionRef: "criterion", contextDistance: "same"};
let repository: UnitSectionPlanRepository;
beforeEach(() => {
  repository = {
    findSource: async () => ({id: "unit", existingSections: [chapter], learningTargets: [], goal: {}}),
    findManifest: async ({userId}) => userId === "owner" ? {sections: [chapter], legacy: null} : null,
    findSectionContent: async () => content,
    findMaterialSource: async () => ({sections: [{...chapter, material: null}], legacy: null}),
  } as unknown as UnitSectionPlanRepository;
  configureUnitSectionPlanPersistence(repository);
});
afterEach(() => {
  configureUnitSectionPlanPersistence(undefined);
  configureReadingContext(undefined);
});

it("completes ready reading with the shared progress record and leaves the mini-test unfinished", async () => {
  configureReadingContext(async (owner, unit, section) => owner === "owner" && unit === "unit" && section === "chapter" ? reading : null);
  const completeOwned = jest.fn(async input => input);
  await completeUnitSection({userId: "owner", unitId: "unit", sectionId: "chapter",
    sectionProgress: {completeOwned} as unknown as UnitSectionProgressRepository});
  expect(completeOwned).toHaveBeenCalledWith(expect.objectContaining({
    sectionId: "chapter", status: "in_progress", contentCompletedAt: expect.any(Date), completedAt: null,
  }));
  await expect(completeUnitSection({userId: "owner", unitId: "unit", sectionId: "mini-test:chapter",
    sectionProgress: {completeOwned} as unknown as UnitSectionProgressRepository})).rejects.toThrow();
  expect(completeOwned).toHaveBeenCalledTimes(1);
});

it("does not complete an unavailable reading body or another owner's chapter", async () => {
  configureReadingContext(async () => null);
  const completeOwned = jest.fn();
  const sectionProgress = {completeOwned} as unknown as UnitSectionProgressRepository;
  await expect(completeUnitSection({userId: "owner", unitId: "unit", sectionId: "chapter", sectionProgress}))
    .rejects.toThrow("Section content is not ready");
  await expect(completeUnitSection({userId: "other", unitId: "unit", sectionId: "chapter", sectionProgress}))
    .rejects.toThrow("Unit not found");
  expect(completeOwned).not.toHaveBeenCalled();
});

it("supplies reading to shared follow-up generation while Display content remains empty", async () => {
  configureReadingContext(async owner => owner === "owner" ? reading : null);
  const material = await runWithUserId("owner", () => getAggregatedUnitMaterial("unit", undefined, {requireAll: true}));
  expect(material?.blocks).toEqual([{type: "paragraph", text: "Subtract 1 on both sides."}]);
  expect((await getUnitSectionContent("owner", "unit", "chapter")).material).toBeNull();
  expect(chapter.generationStatus).toBe("pending");
});

it("keeps a persisted reading quiz from masquerading as generated Display content", async () => {
  repository.findSectionContent = async () => ({...content, material: {introduction: "",
    blocks: JSON.stringify([{type: "heading", level: 2, text: "Section questions"}, check]),
    keyTakeaways: "[]", contextSources: "[]"}});
  expect((await getUnitSectionContent("owner", "unit", "chapter")).material).toBeNull();
  const quiz = await getUnitSectionContent("owner", "unit", "mini-test:chapter");
  expect(quiz.material?.blocks).toContainEqual(expect.objectContaining({checkId: "shared-check"}));
  expect(quiz.blockOffset).toBe(0);
});

it("authors the shared mini-test from ready reading without generating or publishing Display", async () => {
  configureReadingContext(async () => reading);
  (compileCourseMaterialInlineCheckArray as jest.Mock).mockResolvedValue([check]);
  repository.findGenerationSource = async () => ({
    section: chapter, material: null, assessmentTargets: [],
    unit: {goalId: "goal", title: "Equations", sq3rData: JSON.stringify({
      survey: {outline: ["Equations"], learningTargetLabels: []}, learningTargets: [], questions: [{text: "Why subtract?"}],
    })},
    sections: [{...chapter, material: null, progress: [{status: "in_progress", contentCompletedAt: new Date()}]}],
  } as never);
  repository.claimGeneration = async () => "claimed";
  repository.ownsGeneration = async () => true;
  repository.heartbeatGeneration = async () => true;
  repository.publishGeneratedMiniTest = jest.fn(async () => ({contentRevision: 2}));
  repository.publishGeneratedContent = jest.fn();
  await generateUnitSectionMaterial({userId: "owner", unitId: "unit", sectionId: "mini-test:chapter"});
  expect(compileCourseMaterialInlineCheckArray).toHaveBeenCalledWith(expect.objectContaining({
    context: expect.stringContaining("Subtract 1 on both sides."),
  }));
  expect(buildMaterialCheckTaskDeclarations).toHaveBeenCalledWith(expect.objectContaining({
    material: {blocks: expect.arrayContaining([check])},
  }));
  const published = (repository.publishGeneratedMiniTest as jest.Mock).mock.calls[0][0];
  expect(JSON.parse(published.blocks).map((block: {type: string}) => block.type)).toEqual(["heading", "check"]);
  expect(repository.publishGeneratedContent).not.toHaveBeenCalled();
});
