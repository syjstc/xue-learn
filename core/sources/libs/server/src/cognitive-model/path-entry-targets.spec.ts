import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import {
  resolveBoundUnitPath,
  validateUnitPathContract,
} from "./path-contract.js";
import { projectApprovedEntryTargets } from "./path-entry-targets.js";
import {
  unitCognitiveModelTargetPrefixBindingSchema,
  type TargetPrefixWire,
} from "./target-first.js";

function scenario() {
  const learningPath = learningPathFixture();
  const path = resolveBoundUnitPath(
    {
      modules: learningPath.modules.map((_, i) => ({
        title: `Module ${i + 1}`,
      })),
      learningPath,
    },
    "Module 2",
    "Lesson 2",
  )!;
  path.unit.requires[0]!.dimensions = ["memory"];
  path.unit.requires[0]!.threshold = 0.5;
  const prefix: TargetPrefixWire = {
    entities: [
      { ref: "e_1", semanticKey: "skill.2", kind: "skill", title: "Skill 2" },
    ],
    learningTargets: [
      {
        ref: "lt_1",
        semanticKey: "lesson.output",
        title: "Use skill",
        explanation: "Use skill",
        learningObjective: "Use skill",
        assessmentCriteria: [{ ref: "lt_1:c1", text: "Use skill" }],
        targetCognitiveLevel: "apply",
        importance: "core",
        importanceWeight: 5,
        difficulty: "medium",
        role: "primary",
        isEntry: false,
        isExit: true,
        planningOutcomeRefs: ["o_2"],
        requirements: ["understanding", "application"].map((dimension) => ({
          entityRef: "e_1",
          dimension: dimension as "understanding" | "application",
          required: true,
          weight: 1,
          threshold: 0.75,
          gate: true,
        })),
      },
    ],
  };
  const external = [{ ref: "x_1", semanticKey: "skill.1", kind: "skill" }];
  return { path, prefix, external };
}
describe("approved prerequisite projection", () => {
  it("repairs the reported missing entry/memory requirement using its exact approved threshold", () => {
    const { path, prefix, external } = scenario();
    const before = structuredClone(prefix);
    expect(() => validateUnitPathContract(prefix, external, path)).toThrow(
      /omits isEntry/,
    );
    const result = projectApprovedEntryTargets(prefix, external, path);
    expect(() =>
      unitCognitiveModelTargetPrefixBindingSchema.parse(result),
    ).not.toThrow();
    expect(() =>
      validateUnitPathContract(result, external, path),
    ).not.toThrow();
    expect(result.learningTargets[1]).toMatchObject({
      isEntry: true,
      isExit: false,
      requirements: [
        {
          entityRef: "x_1",
          dimension: "memory",
          required: true,
          threshold: 0.5,
        },
      ],
    });
    expect(prefix).toEqual(before);
    expect(result.learningTargets[0]).toEqual(before.learningTargets[0]);
    expect(projectApprovedEntryTargets(result, external, path)).toEqual(result);
  });
  it("binds a missing planned identity without changing exit requirements or accepting lower thresholds", () => {
    const { path, prefix } = scenario();
    const result = projectApprovedEntryTargets(prefix, [], path);
    expect(result.entities).toContainEqual(
      expect.objectContaining({ semanticKey: "skill.1", kind: "skill" }),
    );
    expect(() => validateUnitPathContract(result, [], path)).not.toThrow();
    result.learningTargets[0]!.requirements[0]!.threshold = 0.1;
    expect(() => validateUnitPathContract(result, [], path)).toThrow(/isExit/);
  });
  it("rejects conflicting kinds and never updates learner evidence", () => {
    const { path, prefix } = scenario();
    expect(() =>
      projectApprovedEntryTargets(
        prefix,
        [{ ref: "x_1", semanticKey: "skill.1", kind: "atom" }],
        path,
      ),
    ).toThrow(/kind changed/);
  });
});
