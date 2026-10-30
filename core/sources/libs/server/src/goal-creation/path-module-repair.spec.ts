import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { validateLearningPath } from "../../../domain/src/learning-path-contract.js";
import { pathContextForModule } from "./learning-path.js";
import { projectPathModule } from "./path-module-projection.js";
import { mergeModulePathRepairs, modulePathRepairSchema, pathAuditFindings } from "./path-module-repair.js";

jest.mock("../goal-authoring/runner.js", () => ({ runGoalAuthoringRound: jest.fn() }));

it("recovers the original audit finding from repeated old retry failures", () => {
  const finding = { moduleId: "m-id", issueCode: "coverage_gap", reason: "Teach and run a planning/replanning loop." };
  let diagnostics = JSON.stringify([finding]);
  for (let i = 0; i < 4; i++) diagnostics = JSON.stringify([`The approved capability path needs revision: ${diagnostics}`]);
  expect(pathAuditFindings(diagnostics, "m-id")).toEqual(["coverage_gap: Teach and run a planning/replanning loop."]);
  expect(pathAuditFindings(diagnostics, "another-id")).toEqual([]);
  expect(pathAuditFindings('["coverage_gap: Missing comparison practice.","Model timeout"]')).toEqual(["coverage_gap: Missing comparison practice."]);
  expect(pathAuditFindings("[]")).toEqual([]);
  expect(pathAuditFindings("This operation was aborted")).toEqual([]);
});

function repairFixture() {
  const path = learningPathFixture(3);
  const module = structuredClone(path.modules[0]!);
  module.units.push({ ...structuredClone(module.units[0]!), unitRef: "u_1_2", title: "Planning and replanning practice", summary: "Implement subgoal verification and replan after a failed step." });
  return { path, repair: { entities: [], module } };
}

it("repairs one module while preserving downstream sources and every unaffected contract", () => {
  const { path, repair } = repairFixture();
  const merged = mergeModulePathRepairs(path, [repair]);
  expect(merged.modules[0]!.units).toHaveLength(2);
  expect(merged.modules.slice(1)).toEqual(path.modules.slice(1));
  expect(merged.entities).toEqual(path.entities);
  expect(merged.baseline).toEqual(path.baseline);
  expect(merged.goal).toEqual(path.goal);
  expect(validateLearningPath(merged, { moduleCount: 3, outcomeCount: 3 }).issues).toEqual([]);
  expect(projectPathModule({ pathContract: pathContextForModule(merged, 0) }, "en")!.structure.units[1]!.title).toContain("replanning");
  expect(mergeModulePathRepairs(merged, [repair])).toEqual(merged);
});

it("rejects lowering exits, deleting original source outputs and renumbering lessons", () => {
  const { path, repair } = repairFixture();
  const lowered = structuredClone(repair);
  lowered.module.provides[0]!.threshold = 0.5;
  expect(() => mergeModulePathRepairs(path, [lowered])).toThrow("frozen exit");
  const missing = structuredClone(repair);
  missing.module.units[0]!.provides[0]!.dimensions = ["understanding"];
  expect(() => mergeModulePathRepairs(path, [missing])).toThrow("existing outputs");
  const renamed = structuredClone(repair);
  renamed.module.units[0]!.unitRef = "u_1_9";
  expect(() => mergeModulePathRepairs(path, [renamed])).toThrow("existing outputs");
});

it("rejects new assumed foundations, future dependencies and identity redefinitions", () => {
  const { path, repair } = repairFixture();
  const hidden = structuredClone(repair);
  hidden.module.units[1]!.requires[0]!.threshold = 0.9;
  expect(() => mergeModulePathRepairs(path, [hidden])).toThrow("missing_baseline");
  const future = structuredClone(repair);
  future.module.units[1]!.requires[0]!.source = "u_2_1";
  expect(() => mergeModulePathRepairs(path, [future])).toThrow("forward_dependency");
  expect(() => mergeModulePathRepairs(path, [{ ...repair, entities: [{ ...path.entities[0]!, kind: "concept" }] }])).toThrow("redefine");
});

it("accepts shared path-tool null fields and restricts commits to the flagged module", () => {
  const { path, repair } = repairFixture();
  const schema = modulePathRepairSchema(path, "m_1");
  expect(schema.safeParse({ part: "module", modules: null, registry: null, ...repair }).success).toBe(true);
  expect(schema.safeParse({ part: "module", entities: [], module: path.modules[1] }).success).toBe(false);
});
