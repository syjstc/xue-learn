import { learningPathFixture } from "./learning-path-contract.fixture.js";
import { resolvePathLessonPrerequisites } from "./path-lesson-prerequisites.js";
import { evaluateModuleKacomStructuralReadiness, moduleCognitiveEntityBudget } from "./module-kacom-readiness.js";

describe("path lesson prerequisite publication", () => {
  it("resolves cross-module edges even when drafts arrive in reverse order", () => {
    const path = learningPathFixture();
    const rows = path.modules.map((contract, i) => ({
      id: `db-${i + 1}`, title: contract.units[0]!.title, orderIndex: 0,
      unitPlanningBrief: JSON.stringify({ pathContract: { contract } }),
    }));
    expect(resolvePathLessonPrerequisites([rows[2]!])).toEqual([]);
    expect(resolvePathLessonPrerequisites([...rows].reverse())).toEqual([
      { unitId: "db-3", prerequisites: ["db-2"] },
      { unitId: "db-2", prerequisites: ["db-1"] },
      { unitId: "db-1", prerequisites: [] },
    ]);
  });
  it("preserves independent branches instead of creating navigation dependencies", () => {
    const path = learningPathFixture(1);
    const contract = path.modules[0]!;
    const first = contract.units[0]!;
    contract.units.push({ ...first, unitRef: "u_1_2", title: "Independent lesson", requires: [] });
    const updates = resolvePathLessonPrerequisites(contract.units.map((unit, orderIndex) => ({
      id: `db-${orderIndex}`, title: unit.title, orderIndex, unitPlanningBrief: { pathContract: { contract } },
    })));
    expect(updates.map((entry) => entry.prerequisites)).toEqual([[], []]);
  });
  it("does not reject a compact module for introducing fewer than eight entities", () => {
    expect(evaluateModuleKacomStructuralReadiness({
      units: [{ modelStatus: "expanded", targetCount: 2, capabilityRefs: ["mc_1"] }],
      expectedCapabilityRefs: ["mc_1"], workingSetEntityCount: 3, newlyAuthoredEntityCount: 1,
      entityBudget: moduleCognitiveEntityBudget(1),
    }).status).toBe("audit_ready");
  });
});
