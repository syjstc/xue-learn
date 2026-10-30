import { learningPathFixture } from "../../../domain/src/learning-path-contract.fixture.js";
import { prepareModuleObjectiveAuthority } from "../../../domain/src/module-objective-authority.js";
import { pathContextForModule } from "./learning-path.js";
import { projectPathModule } from "./path-module-projection.js";

it("projects the approved skeleton without an LLM and preserves KACOM identity and thresholds", () => {
  const path = learningPathFixture(1);
  const projected = projectPathModule(
    { pathContract: pathContextForModule(path, 0) },
    "en",
  )!;
  expect(projected.structure.units).toHaveLength(1);
  expect(projected.structure.units[0]!.title).toBe("Lesson 1");
  expect(projected.structure.units[0]!.contentSummary).toContain(
    "Perform operation 1.",
  );
  expect(projected.capabilities[0]).toMatchObject({
    semanticKey: "skill.1",
    entityKind: "skill",
    threshold: 0.75,
  });
  const authority = prepareModuleObjectiveAuthority({
    moduleCurriculumKey: "module-key",
    entryFoundationBriefs: [],
    capabilities: projected.capabilities,
    units: [
      { ...projected.structure.units[0]!, unitId: "u1", curriculumKey: "uk1" },
    ],
    coverageRationale: projected.structure.coverageRationale,
  });
  expect(authority.entities[0]).toMatchObject({
    kind: "skill",
    payload: { semanticKey: "skill.1" },
  });
  expect(
    authority.targets[0]!.requirements.every(
      (entry) => entry.threshold === 0.75,
    ),
  ).toBe(true);
});

it("supports legacy plans but never silently discards a malformed bound path", () => {
  expect(projectPathModule({}, "en")).toBeUndefined();
  expect(() => projectPathModule({ pathContract: {} }, "en")).toThrow();
});

it("replays a prepared contract with empty diagnostics but preserves real audit findings", () => {
  const brief = {
    pathContract: pathContextForModule(learningPathFixture(1), 0),
  };
  expect(projectPathModule(brief, "en", "[]")).toEqual(
    projectPathModule(brief, "en"),
  );
  expect(() => projectPathModule(brief, "en", '["coverage_gap"]')).toThrow(
    "needs revision",
  );
  expect(() => projectPathModule(brief, "en", "untaught prerequisite")).toThrow(
    "needs revision",
  );
});
