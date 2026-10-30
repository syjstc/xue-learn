import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { validateLearningPath } from "../../../domain/src/learning-path-contract.js";
import { runGoalPathAuthoring } from "./path.js";
import { runGoalAuthoringRound } from "./runner.js";
import { moduleCommitSchema, registryCommitSchema } from "./path-parts.js";

jest.mock("./runner.js", () => ({ runGoalAuthoringRound: jest.fn() }));
const mockRun = jest.mocked(runGoalAuthoringRound);
const path = learningPathFixture();
const registry = { entities: path.entities, baseline: path.baseline, goal: path.goal,
  moduleTargets: path.modules.map(({ moduleRef, provides }) => ({ moduleRef, provides })) };
const summaries = path.modules.map((_, index) => ({ title: `Module ${index + 1}`,
  summary: "Establish the next operation.", objective: "Apply the operation independently.",
  dependsOnPrevious: "The earlier operation." }));
const identity = { schemaVersion: 2 as const, refinedTitle: "Operations",
  domainAnalysis: { field: "Math", subdomain: "Operations", learningMode: "skill_practice" as const,
    domainTag: "stem" as const, topicCategory: "mathematics" as const,
    modeClarification: "Learn through practice.", alternateInterpretations: [] },
  topicOverview: "Build three related operations.", whatYouWillLearn: ["First", "Second", "Third"], prerequisitesAssumed: [] };

beforeEach(() => mockRun.mockReset());

it("assembles separately validated commits without asking the model to copy the final path", async () => {
  const proposals = [{ part: "outline", modules: summaries }, { part: "registry", registry },
    ...path.modules.map((module) => ({ part: "module", entities: [], module }))];
  mockRun.mockImplementation(async (input) => input.resultSchema.parse(proposals.shift()));
  const onProgress = jest.fn();
  const result = await runGoalPathAuthoring({ userId: "user-1", goalId: "goal-1",
    identity, instruction: "Stable instruction prefix.", onProgress });
  expect(result.learningPath).toEqual(path);
  expect(validateLearningPath(result.learningPath, { moduleCount: 3, outcomeCount: 3 }).issues).toEqual([]);
  expect(mockRun).toHaveBeenCalledTimes(5);
  expect(mockRun.mock.calls.every(([call]) => call.expectedTool === "commit_goal_path_part")).toBe(true);
  expect(mockRun.mock.calls.slice(0, -1).every(([call]) => !call.markBlueprint)).toBe(true);
  expect(mockRun.mock.calls.at(-1)![0].markBlueprint).toBe(true);
  expect(mockRun.mock.calls[0]![0].prompt).toContain("o_3: Third");
  expect(mockRun.mock.calls.slice(1).every(([call]) => !call.prompt.includes("Stable instruction prefix."))).toBe(true);
  expect(onProgress.mock.calls.map(([progress]) => progress.unitCount)).toEqual([0, 1, 2, 3]);
});

it("rejects a registry that promises goal requirements no module can provide", () => {
  const invalid = structuredClone(registry);
  invalid.goal.outcomes[0]!.requires[0]!.threshold = 0.95;
  expect(registryCommitSchema(3, 3).safeParse({ part: "registry", registry: invalid }).success).toBe(false);
});

it("shows later modules only real exported source dimensions and thresholds", async () => {
  const first = structuredClone(path.modules[0]!);
  first.units[0]!.provides[0]!.threshold = 0.95;
  first.units[0]!.provides.push({ entityKey: "skill.hidden", dimensions: ["understanding"], threshold: 0.9 });
  const bridge = { semanticKey: "skill.hidden", kind: "skill" as const, title: "Local bridge", description: "An intermediate operation.", scope: "This lesson." };
  const proposals = [{ part: "outline", modules: summaries }, { part: "registry", registry },
    { part: "module", entities: [bridge], module: first },
    ...path.modules.slice(1).map((module) => ({ part: "module", entities: [], module }))];
  mockRun.mockImplementation(async (input) => input.resultSchema.parse(proposals.shift()));
  await runGoalPathAuthoring({ userId: "user-1", goalId: "goal-1", identity, instruction: "Teach operations." });
  const secondPrompt = mockRun.mock.calls[3]![0].prompt;
  const sources = secondPrompt.match(/AVAILABLE EXTERNAL SOURCES[^\n]*\n([\s\S]*?)\nEvery requires/)![1]!;
  const available = JSON.parse(sources);
  expect(sources).not.toContain("skill.hidden");
  expect(available.find((entry: { source: string }) => entry.source === "u_1_1").provides[0].threshold).toBe(0.75);
});

it("accepts null inactive strict-provider fields but rejects repeated non-null parts", () => {
  const schema = registryCommitSchema(3, 3);
  expect(schema.parse({ part: "registry", registry, modules: null, module: null, entities: null })).toEqual({ part: "registry", registry });
  expect(schema.safeParse({ part: "registry", registry, modules: summaries }).success).toBe(false);
});

it("validates current module dependencies while future goal outcomes remain pending", () => {
  const schema = moduleCommitSchema({ registry, entities: registry.entities, previous: [path.modules[0]!], moduleCount: 3, outcomeCount: 3 });
  expect(schema.safeParse({ part: "module", module: path.modules[1] }).success).toBe(true);
  const invalid = structuredClone(path.modules[1]!);
  invalid.units[0]!.requires[0]!.source = "u_3_1";
  const parsed = schema.safeParse({ part: "module", module: invalid });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.message).toContain("forward_dependency");
});

it("rejects a final module that drops a frozen exit or redefines an existing identity", () => {
  const schema = moduleCommitSchema({ registry, entities: registry.entities, previous: path.modules.slice(0, 2), moduleCount: 3, outcomeCount: 3 });
  const invalid = structuredClone(path.modules[2]!);
  invalid.provides[0]!.threshold = 0.5;
  expect(schema.safeParse({ part: "module", module: invalid }).success).toBe(false);
  const duplicate = schema.safeParse({ part: "module", module: path.modules[2], entities: [path.entities[0]] });
  expect(duplicate.success).toBe(false);
  if (!duplicate.success) expect(duplicate.error.message).toContain("duplicate_identity");
});
