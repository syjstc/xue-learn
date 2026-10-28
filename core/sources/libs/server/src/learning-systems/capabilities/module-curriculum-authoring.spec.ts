import {
  prepareExplorationModuleStructureAuthoring,
  prepareModuleCapabilitiesAuthoring,
  prepareModuleStructureAuthoring,
  type ModuleCapabilityProposal,
} from "./module-curriculum.js";

const capability = (
  title: string,
): ModuleCapabilityProposal["capabilities"][number] => ({
  title,
  objective: `Demonstrate ${title}`,
  assessmentCriteria: ["criterion one", "criterion two"],
  dimensions: ["understanding", "application"],
  criticalCompletionGate: title === "three",
  cognitiveLevel: "apply",
  difficulty: "medium",
});

const brief = {
  scopeSize: "compact" as const,
  rationale: "Two focused lessons",
  progression: ["Foundation", "Integration"],
};

describe("portable module curriculum authoring", () => {
  it("preserves the hosted capability operation/prompt and normalizes provider enums", () => {
    const prepared = prepareModuleCapabilitiesAuthoring({
      goalTitle: "Course",
      moduleTitle: "Module",
      moduleObjective: "Apply the method",
      capabilityBriefs: ["one", "two", "three"],
      priorModuleSummary: "",
      contentLanguage: "en",
    });

    expect(prepared.operation).toBe("module.capabilities");
    expect(prepared.standalonePrompt).toContain(
      "authoritative exit-capability contracts",
    );
    const result = prepared.parseProviderOutput(
      JSON.stringify({
        capabilities: [
          capability("one"),
          capability("two"),
          {
            ...capability("three"),
            difficulty: "high",
            cognitiveLevel: "应用",
            dimensions: ["理解", "应用"],
          },
          capability("discarded"),
        ],
      }),
    );
    expect(result.capabilities).toHaveLength(4);
    expect(result.capabilities[2]).toMatchObject({
      difficulty: "hard",
      cognitiveLevel: "apply",
      dimensions: ["understanding", "application"],
    });
  });

  it("accepts Bloom-mixed dimensions through the agent wire schema", () => {
    const prepared = prepareModuleCapabilitiesAuthoring({
      goalTitle: "Course",
      moduleTitle: "Module",
      moduleObjective: "Apply the method",
      capabilityBriefs: ["one", "two", "three"],
      priorModuleSummary: "",
      contentLanguage: "zh-Hans",
    });
    const result = prepared.acceptSchema.parse({
      capabilities: [
        capability("one"),
        {
          ...capability("two"),
          dimensions: ["understand", "apply", "reasoning"],
        },
        capability("three"),
      ],
    });
    expect(result.capabilities[1]?.dimensions).toEqual([
      "understanding",
      "application",
    ]);
  });

  it("accepts one compact lesson when it covers every capability", () => {
    const prepared = prepareModuleStructureAuthoring({
      goalTitle: "Course",
      goalLevel: "beginner",
      moduleTitle: "Module",
      moduleSummary: "Summary",
      moduleObjective: "Objective",
      capabilities: [capability("one"), capability("two"), capability("three")],
      priorModuleSummary: "",
      priorCognitiveContext: "",
      contentLanguage: "en",
    });
    const result = prepared.parseProviderOutput(
      JSON.stringify({
        units: [
          {
            title: "Integrated practice",
            contentSummary: "Cover the module exit in one focused lesson.",
            difficulty: "medium",
            capabilityRefs: ["mc_1", "mc_2", "mc_3"],
            milestoneRole: "integrate",
          },
        ],
        coverageRationale: "One lesson is enough for this narrow milestone.",
      }),
    );
    expect(result.units).toHaveLength(1);
  });

  it("validates exact mastery coverage and fails closed on incomplete output", () => {
    const prepared = prepareModuleStructureAuthoring({
      goalTitle: "Course",
      goalLevel: "beginner",
      moduleTitle: "Module",
      moduleSummary: "Summary",
      moduleObjective: "Objective",
      plannedOutcomes: ["Outcome"],
      estimatedUnitCount: 2,
      unitPlanningBrief: brief,
      capabilities: [capability("one"), capability("two"), capability("three")],
      priorModuleSummary: "",
      priorCognitiveContext: "",
      contentLanguage: "en",
    });
    expect(prepared.operation).toBe("module.structure");
    expect(prepared.standalonePrompt).toContain("do not pad toward 3–8");
    expect(() =>
      prepared.parseProviderOutput(
        JSON.stringify({
          units: [
            {
              title: "Only one",
              contentSummary: "Incomplete",
              difficulty: "medium",
              capabilityRefs: ["mc_1"],
              milestoneRole: "introduce",
            },
          ],
          coverageRationale: "Incomplete",
        }),
      ),
    ).toThrow();
  });

  it("keeps exploration output KACOM-free and normalizes provider aliases", () => {
    const prepared = prepareExplorationModuleStructureAuthoring({
      goalTitle: "Course",
      goalLevel: "beginner",
      moduleTitle: "Explore",
      moduleSummary: "Summary",
      moduleObjective: "Read broadly",
      plannedOutcomes: ["Synthesize"],
      estimatedUnitCount: 2,
      unitPlanningBrief: brief,
      priorModuleSummary: "",
      contentLanguage: "en",
    });
    expect(prepared.operation).toBe("module.exploration_structure");
    const result = prepared.parseProviderOutput(
      JSON.stringify({
        units: [
          {
            title: "Read",
            contentSummary: "Orient",
            difficulty: "beginner",
            milestoneRole: "intro",
          },
          {
            title: "Synthesize",
            contentSummary: "Integrate",
            difficulty: "high",
            milestoneRole: "assessment",
          },
        ],
        coverageRationale: "Progressive reading",
      }),
    );
    expect(result.units).toEqual([
      expect.objectContaining({
        difficulty: "easy",
        milestoneRole: "introduce",
      }),
      expect.objectContaining({ difficulty: "hard", milestoneRole: "verify" }),
    ]);
    expect(result.units[0]).not.toHaveProperty("capabilityRefs");
  });

  it("keeps audit repair feedback visible after long source context", () => {
    const findings =
      "insufficient_practice: add an independent interface diagram and feedback";
    const prepared = prepareExplorationModuleStructureAuthoring({
      goalTitle: "World models",
      goalLevel: "zero",
      moduleTitle: "Model interfaces",
      moduleSummary: "From examples to new tasks",
      moduleObjective: "Draw a new task interface independently",
      priorModuleSummary: "",
      sourceContext: `${"s".repeat(12_000)}\nE17: independently validate a complete model`,
      validationFindings: findings,
      contentLanguage: "en",
    });
    expect(prepared.standalonePrompt).toContain(findings);
    expect(prepared.standalonePrompt).toContain(
      "learner-produced example on new material",
    );
    expect(prepared.standalonePrompt).toContain("s".repeat(12_000));
    expect(prepared.standalonePrompt).toContain("E17: independently validate a complete model");
    expect(prepared.standalonePrompt).toContain("map relevant source section identifiers");
  });
});

describe("module prerequisite and capacity boundaries", () => {
  const prepared = () =>
    prepareModuleStructureAuthoring({
      goalTitle: "零基础大学力学",
      goalLevel: "zero",
      moduleTitle: "运动学",
      moduleSummary: "从变化率到运动模型",
      moduleObjective: "分析运动",
      capabilities: [capability("one"), capability("two"), capability("three")],
      priorModuleSummary: "",
      priorCognitiveContext: "",
      contentLanguage: "zh-Hans",
    });
  const unit = {
    title: "运动",
    contentSummary: "先解释变化率再使用导数",
    difficulty: "medium",
    capabilityRefs: ["mc_1", "mc_2", "mc_3"],
    milestoneRole: "integrate",
  };
  it("rejects provider overflow instead of silently dropping final lessons", () => {
    expect(() =>
      prepared().parseResult({
        units: Array.from({ length: 21 }, () => unit),
        coverageRationale: "All needed",
      }),
    ).toThrow();
  });
  it("rejects a forward prerequisite on the actual provider acceptance path", () => {
    expect(() =>
      prepared().acceptSchema.parse({
        units: [
          {
            ...unit,
            knowledgeSequence: {
              requiredKnowledge: ["导数"],
              taughtKnowledge: ["速度"],
              dependsOnUnits: [2],
              foundationsToTeachFirst: [],
            },
          },
          unit,
        ],
        coverageRationale: "Uses future math",
      }),
    ).toThrow();
  });
});
