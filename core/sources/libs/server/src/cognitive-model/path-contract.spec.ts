import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { resolveBoundUnitPath, validateUnitPathContract } from "./path-contract.js";
import { buildExternalEntityCatalog } from "./generation.js";

function scenario() {
  const learningPath = learningPathFixture();
  const plan = { modules: learningPath.modules.map((_, i) => ({ title: `Module ${i + 1}` })), learningPath };
  const bound = resolveBoundUnitPath(plan, "Module 2", "Lesson 2")!;
  const external = [{ ref: "x_1", kind: "skill", semanticKey: "skill.1" }];
  const proposal = {
    entities: [{ ref: "e_1", kind: "skill", semanticKey: "skill.2" }],
    learningTargets: [
      { isEntry: true, isExit: false, requirements: ["understanding", "application"].map((dimension) => ({ entityRef: "x_1", dimension, threshold: 0.75, required: true })) },
      { isEntry: false, isExit: true, requirements: ["understanding", "application"].map((dimension) => ({ entityRef: "e_1", dimension, threshold: 0.75, required: true })) },
    ],
  };
  return { bound, external, proposal, plan };
}

describe("approved path to KACOM binding", () => {
  it("resolves only the current lesson and its supported outcome", () => {
    const { bound } = scenario();
    expect(bound.unit.unitRef).toBe("u_2_1");
    expect(bound.entities.map((entity) => entity.semanticKey)).toEqual(["skill.1", "skill.2"]);
    expect(bound.planningOutcomeRefs).toEqual(["o_2"]);
    expect(resolveBoundUnitPath(null, "Module 2", "Lesson 2")).toBeUndefined();
  });

  it("accepts existing graph identities and leaves learner state untouched", () => {
    const { bound, external, proposal } = scenario();
    const before = JSON.stringify({ bound, external, proposal });
    expect(() => validateUnitPathContract(proposal, external, bound)).not.toThrow();
    expect(JSON.stringify({ bound, external, proposal })).toBe(before);
    proposal.entities = [];
    external.push({ ref: "e_1", kind: "skill", semanticKey: "skill.2" });
    expect(() => validateUnitPathContract(proposal, external, bound)).not.toThrow();
  });

  it.each(["synonym", "kind", "dimension", "threshold", "entry"] as const)(
    "rejects a %s deviation before the prefix is published", (deviation) => {
      const { bound, external, proposal } = scenario();
      if (deviation === "synonym") proposal.entities[0]!.semanticKey = "different.skill";
      if (deviation === "kind") proposal.entities[0]!.kind = "competency";
      if (deviation === "dimension") proposal.learningTargets[1]!.requirements.pop();
      if (deviation === "threshold") proposal.learningTargets[1]!.requirements[0]!.threshold = 0.7;
      if (deviation === "entry") proposal.learningTargets[0]!.isEntry = false;
      expect(() => validateUnitPathContract(proposal, external, bound)).toThrow(/KACOM path/);
    },
  );

  it("keeps required planned entities in a bounded external alias catalog", () => {
    const entities = Array.from({ length: 65 }, (_, i) => ({
      id: `id${i}`, stableKey: `key${String(i).padStart(2, "0")}`,
      semanticKey: `skill.${i}`, kind: "skill", title: `Skill ${i}`, description: "Use this operation",
    }));
    const catalog = buildExternalEntityCatalog({
      entities, currentCurriculumKey: "current", predecessorExitEntityIds: new Set(),
      preferredSemanticKeys: new Set(["skill.64"]), maximumEntities: 2,
    });
    expect(catalog.map((entity) => entity.semanticKey)).toContain("skill.64");
    expect(catalog).toHaveLength(2);
  });
});
