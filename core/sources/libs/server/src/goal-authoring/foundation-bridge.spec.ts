import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { validateLearningPath } from "../../../domain/src/learning-path-contract.js";
import type { GoalMapPlan } from "../llm/schemas.js";
import {
  addFoundationBridge,
  canAddFoundationBridge,
  mergeFoundationBridge,
} from "./foundation-bridge.js";
import { runGoalAuthoringRound } from "./runner.js";

jest.mock("./runner.js", () => ({ runGoalAuthoringRound: jest.fn() }));
const run = jest.mocked(runGoalAuthoringRound);
function fixture(count = 3) {
  const learningPath = learningPathFixture(count);
  return {
    whatYouWillLearn: ["First", "Second", "Third"],
    prerequisitesAssumed: ["Ability 0"],
    mapStructure: { estimatedLeafUnits: count },
    modules: learningPath.modules.map((_, index) => ({
      title: `Module ${index + 1}`,
      summary: "Existing scope",
    })),
    learningPath,
  } as GoalMapPlan;
}
function bridge(plan: GoalMapPlan) {
  const requirement = plan.learningPath!.baseline[0]!;
  const provides = [
    {
      entityKey: requirement.entityKey,
      dimensions: [...requirement.dimensions],
      threshold: requirement.threshold,
    },
  ];
  const assessment = structuredClone(plan.learningPath!.modules[0]!.assessment);
  return {
    entities: [],
    module: {
      moduleRef: "m_1",
      requires: [],
      provides,
      assessment,
      rationale: "Teach the explicitly missing entry foundation.",
      units: [
        {
          unitRef: "u_1_1",
          title: "Entry foundation",
          summary: "Practice the missing operation.",
          difficulty: "easy" as const,
          milestoneRole: "practice" as const,
          requires: [],
          provides,
          supports: [requirement.entityKey],
          assessment,
          rationale: "Supply the entry requirement before first use.",
        },
      ],
    },
  };
}

beforeEach(() => run.mockReset());

it("adds one bridge turn while preserving all eight validated module contracts", async () => {
  const plan = fixture(8);
  const before = structuredClone(plan);
  run.mockImplementation(async (input) =>
    input.resultSchema.parse({ part: "module", ...bridge(plan) }),
  );
  const revised = await addFoundationBridge({
    userId: "user",
    goalId: "goal",
    plan,
    entityKey: "skill.0",
    contentLanguage: "en",
  });
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]![0].markBlueprint).toBe(true);
  expect(revised.mapStructure.estimatedLeafUnits).toBe(9);
  expect(revised.modules).toEqual(before.modules);
  expect(revised.whatYouWillLearn).toEqual(before.whatYouWillLearn);
  expect(revised.learningPath!.modules).toHaveLength(8);
  expect(
    revised.learningPath!.modules.reduce(
      (count, module) => count + module.units.length,
      0,
    ),
  ).toBe(9);
  expect(revised.learningPath!.modules[0]!.units[1]!.unitRef).toBe("u_1_2");
  expect(revised.learningPath!.modules[1]!.requires[0]!.source).toBe("u_1_2");
  expect(revised.learningPath!.modules[1]!.units[0]!.requires[0]!.source).toBe(
    "u_1_2",
  );
  expect(revised.learningPath!.baseline).toEqual([]);
  expect(revised.prerequisitesAssumed).toEqual([]);
  expect(plan).toEqual(before);
  expect(
    validateLearningPath(revised.learningPath!, {
      moduleCount: 8,
      outcomeCount: 3,
    }).issues,
  ).toEqual([]);
});

it("redirects later direct baseline inputs to the new bridge without rewriting later lessons", () => {
  const plan = fixture();
  const input = structuredClone(plan.learningPath!.modules[0]!.requires[0]!);
  plan.learningPath!.modules[1]!.requires.push(input);
  plan.learningPath!.modules[1]!.units[0]!.requires.push(input);
  const revised = mergeFoundationBridge(plan, "skill.0", bridge(plan));
  expect(revised.learningPath!.modules[1]!.requires[1]!.source).toBe("u_1_1");
  expect(revised.learningPath!.modules[1]!.units[0]!.title).toBe(
    plan.learningPath!.modules[1]!.units[0]!.title,
  );
  expect(
    validateLearningPath(revised.learningPath!, {
      moduleCount: 3,
      outcomeCount: 3,
    }).issues,
  ).toEqual([]);
});

it("rejects an assumed, underspecified or overgrown bridge without mutating the existing plan", () => {
  const plan = fixture();
  const before = structuredClone(plan);
  const invalid = bridge(plan);
  invalid.module.units[0]!.provides[0]!.threshold = 0.5;
  expect(() => mergeFoundationBridge(plan, "skill.0", invalid)).toThrow(
    "bridge must supply",
  );
  const assumed = bridge(plan);
  assumed.module.requires = [
    plan.learningPath!.modules[0]!.requires[0]!,
  ] as never;
  assumed.module.units[0]!.requires = structuredClone(assumed.module.requires);
  expect(() => mergeFoundationBridge(plan, "skill.0", assumed)).toThrow(
    "missing_baseline",
  );
  const oversized = bridge(plan);
  oversized.module.units = Array.from({ length: 4 }, () =>
    structuredClone(oversized.module.units[0]!),
  );
  expect(() => mergeFoundationBridge(plan, "skill.0", oversized)).toThrow(
    "one to three",
  );
  expect(plan).toEqual(before);
});

it("rejects a stale foundation selection before another model call", async () => {
  await expect(
    addFoundationBridge({
      userId: "user",
      goalId: "goal",
      plan: fixture(),
      entityKey: "not.selected",
      contentLanguage: "en",
    }),
  ).rejects.toThrow("no longer");
  expect(run).not.toHaveBeenCalled();
});

it("keeps full revision available when the first module cannot safely hold a small bridge", () => {
  const plan = fixture();
  expect(canAddFoundationBridge(plan, "skill.0")).toBe(true);
  plan.learningPath!.modules[0]!.units = Array.from({ length: 18 }, () =>
    structuredClone(plan.learningPath!.modules[0]!.units[0]!),
  );
  expect(canAddFoundationBridge(plan, "skill.0")).toBe(false);
  expect(canAddFoundationBridge(fixture(), "stale.foundation")).toBe(false);
});


it("accepts the strict provider's null inactive bridge identities without another authoring attempt", async () => {
  const plan = fixture();
  run.mockImplementation(async (input) => input.resultSchema.parse({ part: "module", ...bridge(plan), entities: null, modules: null, registry: null, moduleBrief: null }));
  await expect(addFoundationBridge({ userId: "user", goalId: "goal", plan, entityKey: "skill.0", contentLanguage: "en" })).resolves.toBeDefined();
  expect(run).toHaveBeenCalledTimes(1);
});
