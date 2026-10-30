import { learningPathFixture } from "./learning-path-contract.fixture.js";
import { learningPathContractSchema, validateLearningPath } from "./learning-path-contract.js";

const validate = (path = learningPathFixture()) =>
  validateLearningPath(path, { moduleCount: 3, outcomeCount: 3 });

describe("whole-goal KACOM path closure", () => {
  it("validates a conditional path without fabricating mastery", () => {
    const path = learningPathContractSchema.parse(learningPathFixture());
    expect(validate(path)).toMatchObject({
      status: "conditional", issues: [], moduleCount: 3, unitCount: 3,
      unverifiedBaselineCount: 1,
    });
    expect(JSON.stringify(path)).not.toContain("mastery");
  });

  it("does not let the planner label a baseline as verified", () => {
    const path = learningPathFixture();
    (path.baseline[0] as { status: string }).status = "verified";
    expect(learningPathContractSchema.safeParse(path).success).toBe(false);
  });

  it.each(["u_2_1", "u_3_1", "u_1_9"])("rejects self/future/missing sources %s", (source) => {
    const path = learningPathFixture();
    path.modules[1]!.units[0]!.requires = [{
      ...path.modules[1]!.units[0]!.requires[0]!, source,
    }];
    expect(validate(path).issues.map((issue) => issue.code)).toContain("forward_dependency");
  });

  it("rejects a stronger threshold or a dimension that was never provided", () => {
    for (const change of [{ threshold: 0.9 }, { dimensions: ["independence" as const] }]) {
      const path = learningPathFixture();
      Object.assign(path.modules[1]!.units[0]!.requires[0]!, change);
      expect(validate(path).issues.map((issue) => issue.code)).toContain("insufficient_output");
    }
  });

  it("rejects hidden module inputs and missing module/goal exits", () => {
    const path = learningPathFixture();
    path.modules[1]!.requires = [];
    path.modules[1]!.provides[0] = { ...path.modules[1]!.provides[0]!, threshold: 0.95 };
    path.goal.outcomes[2]!.requires[0]!.threshold = 1;
    expect(validate(path).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "hidden_module_input", "module_exit_gap", "goal_exit_gap",
    ]));
  });

  it("requires all branches at convergence, not just one available input", () => {
    const path = learningPathFixture();
    path.modules[2]!.units[0]!.requires.push({
      entityKey: "skill.1", dimensions: ["transfer"], threshold: 0.75,
      source: "u_1_1", rationale: "Both abilities are needed.",
    });
    expect(validate(path).status).toBe("invalid");
  });

  it("requires explicit far and independent evidence for those dimensions", () => {
    const path = learningPathFixture();
    path.modules[2]!.units[0]!.provides = [{
      entityKey: "skill.3", dimensions: ["transfer", "independence"], threshold: 0.75,
    }];
    path.modules[2]!.units[0]!.assessment = {
      ...path.modules[2]!.units[0]!.assessment, assistance: "guided",
    };
    expect(validate(path).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "transfer_evidence", "independence_evidence",
    ]));
  });

  it("detects orphan identities, duplicate identities and missing goal outcomes", () => {
    const path = learningPathFixture();
    path.entities.push({ ...path.entities[0]!, semanticKey: "unused" }, path.entities[0]!);
    path.goal.outcomes.pop();
    expect(validate(path).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "unused_entity", "duplicate_identity", "missing_outcome",
    ]));
  });
});
