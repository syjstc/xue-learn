import type { LearningPathContract, PathRequirement } from "./learning-path-contract.js";

export function learningPathFixture(moduleCount = 3): LearningPathContract {
  const requirement = (entityKey: string): PathRequirement => ({
    entityKey, dimensions: ["understanding", "application"], threshold: 0.75,
  });
  const assessment = {
    task: "Solve a new example and explain the result.",
    criteria: ["The result is correct.", "The method is explained."],
    assistance: "independent" as const,
    context: "near" as const,
  };
  const path: LearningPathContract = {
    schemaVersion: 1,
    entities: Array.from({ length: moduleCount + 1 }, (_, i) => ({
      semanticKey: `skill.${i}`,
      kind: "skill" as const,
      title: `Ability ${i}`,
      description: `Perform operation ${i}.`,
      scope: "Routine examples in the confirmed domain.",
    })),
    baseline: [{ ...requirement("skill.0"), status: "unknown", rationale: "Entry foundation needs checking." }],
    goal: {
      outcomes: Array.from({ length: 3 }, (_, i) => ({
        outcomeRef: `o_${i + 1}`,
        requires: [requirement(`skill.${Math.min(i + 1, moduleCount)}`)],
      })),
      assessment,
    },
    modules: Array.from({ length: moduleCount }, (_, i) => {
      const requires = [{
        ...requirement(`skill.${i}`),
        source: i ? `u_${i}_1` : "baseline",
        rationale: "Use the previous operation to construct the next result.",
      }];
      const provides = [requirement(`skill.${i + 1}`)];
      return {
        moduleRef: `m_${i + 1}`,
        requires, provides, assessment,
        rationale: "This lesson establishes the module exit.",
        units: [{
          unitRef: `u_${i + 1}_1`,
          title: `Lesson ${i + 1}`,
          summary: `Apply operation ${i} to learn operation ${i + 1}.`,
          difficulty: "medium",
          milestoneRole: "integrate",
          requires, provides, assessment,
          supports: [`skill.${i + 1}`],
          rationale: "Extend the known operation and verify it.",
        }],
      };
    }),
  };
  return JSON.parse(JSON.stringify(path));
}
