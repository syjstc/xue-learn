import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { learningPathFixture } from "../../../../domain/src/learning-path-contract.fixture.js";
import { runGoalAuthoringRound } from "../../goal-authoring/runner.js";
import { runGoalPathAuthoring } from "../../goal-authoring/path.js";
import { parseMapPlan, serializeMapPlan } from "../../goals/map-plan.js";
import {
  buildGoalMapPlanPrompt,
  buildGoalIdentityPrompt,
  buildGoalJourneyPrompt,
  planGoalMapStream,
  prepareGoalCurriculumPlanAuthoring,
  sequentialModuleRepairTarget,
} from "./curriculum-planning.js";

jest.mock("../../llm/validated-structured-generation.js", () => ({
  runValidatedStructuredGeneration: jest.fn(),
}));
jest.mock("../../goal-authoring/runner.js", () => ({
  runGoalAuthoringRound: jest.fn(),
}));
jest.mock("../../goal-authoring/path.js", () => ({
  runGoalPathAuthoring: jest.fn(),
  goalAuthoringCheckpointKey: () => "checkpoint-1",
}));

const mockedRunValidated = jest.mocked(runValidatedStructuredGeneration);
const mockedRunGoalAuthoringRound = jest.mocked(runGoalAuthoringRound);
const mockedRunGoalPath = jest.mocked(runGoalPathAuthoring);

describe("prepareGoalCurriculumPlanAuthoring", () => {
  it("keeps later uploaded source requirements in both blueprint stages", () => {
    const input = {
      title: "Physics", level: "basic", contentLanguage: "en" as const,
      pathSource: "rag" as const,
      context: `${"source content ".repeat(3_000)}\nE17: independent research project`,
    };
    expect(buildGoalMapPlanPrompt(input)).toContain("E17: independent research project");
    expect(buildGoalIdentityPrompt(input)).toContain("E17: independent research project");
    expect(buildGoalJourneyPrompt(input, {
      prerequisitesAssumed: [], whatYouWillLearn: ["Validate a model"],
      domainAnalysis: { field: "Physics", subdomain: "Energy", learningMode: "mixed" },
      topicOverview: "Physics through energy",
    } as never)).toContain("E17: independent research project");
  });
  beforeEach(() => {
    mockedRunValidated.mockReset();
    mockedRunGoalAuthoringRound.mockReset();
    mockedRunGoalPath.mockReset();
  });
  it("reuses the hosted prompt/schema/normalization for deep planning", () => {
    const input = {
      title: "Build a TypeScript API",
      level: "basic",
      context: "Verified research about typed API design.",
      pathSource: "search" as const,
      contentLanguage: "en" as const,
      generationOptions: "Prioritize practical debugging.",
      planningMode: "deep" as const,
    };
    const prepared = prepareGoalCurriculumPlanAuthoring(input);

    expect(prepared.operation).toBe("goal.curriculum.plan.deep_blueprint");
    expect(prepared.prompt).toBe(buildGoalMapPlanPrompt(input));
    expect(prepared.standalonePrompt).toContain(
      "confirmed goal, level, scope, language",
    );
    expect(prepared.contextInvocation).not.toHaveProperty("planningMode");
  });

  it("fails closed when docs-first context was not prepared upstream", () => {
    expect(() =>
      prepareGoalCurriculumPlanAuthoring({
        title: "Learn from my handbook",
        level: "basic",
        pathSource: "generic",
        contentLanguage: "en",
        planningMode: "docs_first",
      }),
    ).toThrow("prepared document context");
  });

  it("keeps hosted generation on the prepared prompt and recovery contract", async () => {
    mockedRunValidated.mockResolvedValueOnce({} as never);
    await planGoalMapStream({
      title: "Learn systems design",
      level: "advanced",
      context: "Verified architecture references",
      pathSource: "search",
      contentLanguage: "en",
      operation: "goal.curriculum.plan.deep_blueprint",
    });

    expect(mockedRunValidated).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Learn systems design"),
        recoveryPolicy: expect.objectContaining({
          normalize: expect.any(Function),
          repairSlots: expect.any(Function),
        }),
        options: expect.objectContaining({
          operation: "goal.curriculum.plan.deep_blueprint",
        }),
      }),
      expect.any(Object),
    );
  });

  it("validates durable blueprint calls with the provider-authored V2 schema", async () => {
    mockedRunGoalAuthoringRound.mockRejectedValueOnce(new Error("stop"));

    await expect(
      planGoalMapStream({
        title: "Learn systems design",
        level: "advanced",
        context: "Verified architecture references",
        pathSource: "search",
        contentLanguage: "en",
        operation: "goal.curriculum.plan.deep_blueprint",
        authoringAgent: { userId: "user-1", goalId: "goal-1" },
      }),
    ).rejects.toThrow("stop");

    const call = mockedRunGoalAuthoringRound.mock.calls[0]?.[0];
    expect(call?.expectedTool).toBe("commit_goal_identity");
    const invalid = call?.resultSchema.safeParse({ schemaVersion: 2 });
    expect(invalid?.success).toBe(false);
    if (invalid?.success === false) {
      const topLevelPaths = invalid.error.issues.map((issue) => issue.path[0]);
      expect(topLevelPaths).toContain("domainAnalysis");
      expect(topLevelPaths).not.toContain("modules");
      expect(topLevelPaths).not.toContain("majorAreas");
      expect(topLevelPaths).not.toContain("mapStructure");
    }
  });

  it("authors identity then assembles separately committed path parts on the durable agent path", async () => {
    const identity = {
      schemaVersion: 2 as const,
      refinedTitle: "Systems design",
      domainAnalysis: {
        field: "Computer science",
        subdomain: "Systems design",
        learningMode: "skill_practice" as const,
        domainTag: "stem" as const,
        topicCategory: "computer_science" as const,
        modeClarification: "Learn by designing systems under real constraints.",
        alternateInterpretations: [],
      },
      topicOverview: "A practical path through systems design.",
      whatYouWillLearn: ["Tradeoffs", "Capacity", "Reliability"],
      prerequisitesAssumed: ["Basic programming"],
    };
    const journey = {
      learningPath: learningPathFixture(),
      modules: [
        {
          title: "Foundations",
          summary: "Name the core constraints.",
          objective: "Explain the main design tradeoffs.",
          dependsOnPrevious: "Basic programming.",
        },
        {
          title: "Practice",
          summary: "Apply the constraints to a typical service.",
          objective: "Design a typical service under load.",
          dependsOnPrevious: "The foundation tradeoffs.",
        },
        {
          title: "Transfer",
          summary: "Move the method into a new constraint set.",
          objective: "Adapt the design method independently.",
          dependsOnPrevious: "The typical service design.",
        },
      ],
    };
    mockedRunGoalAuthoringRound.mockResolvedValueOnce(identity);
    mockedRunGoalPath.mockResolvedValueOnce(journey);
    const onIdentity = jest.fn();

    const result = await planGoalMapStream({
      title: "Learn systems design",
      level: "advanced",
      context: "Verified architecture references",
      pathSource: "search",
      contentLanguage: "en",
      operation: "goal.curriculum.plan.deep_blueprint",
      authoringAgent: { userId: "user-1", goalId: "goal-1" },
      onIdentity,
    });

    expect(
      mockedRunGoalAuthoringRound.mock.calls.map((call) => call[0]?.expectedTool),
    ).toEqual(["commit_goal_identity"]);
    expect(onIdentity).toHaveBeenCalledWith(identity);
    expect(mockedRunGoalAuthoringRound.mock.calls[0]![0].checkpointKey).toContain("goal-identity:v1:");
    expect(mockedRunGoalPath).toHaveBeenCalledWith(expect.objectContaining({ identity, goalId: "goal-1" }));
    expect(result.modules?.map((module) => module.title)).toEqual([
      "Foundations",
      "Practice",
      "Transfer",
    ]);
    expect(result.prerequisitesAssumed).toEqual(["Basic programming"]);
    expect(result.mapStructure.estimatedLeafUnits).toBe(3);
    const reloaded = parseMapPlan(serializeMapPlan(result))!;
    expect(reloaded.learningPath).toEqual(journey.learningPath);
    expect(reloaded.modules?.[1]?.unitPlanningBrief.pathContract?.contract).toEqual(journey.learningPath.modules[1]);
    const broken = structuredClone(result);
    broken.learningPath!.modules[1]!.units[0]!.requires[0]!.source = "u_3_1";
    expect(() => serializeMapPlan(broken)).toThrow();
  });

  it("matches module count to confirmed scope instead of a textbook quota", () => {
    const prompt = buildGoalMapPlanPrompt({
      title: "拉格朗日中值定理及其证明",
      level: "basic",
      pathSource: "generic",
      contentLanguage: "zh-Hans",
    });
    expect(prompt).toContain("match the confirmed goal's actual scope");
    expect(prompt).toContain("Use one module when the entire goal is a single");
    expect(prompt).toContain('Never pad toward 3–6 modules');
    expect(prompt).toContain(
      "Do not collapse a genuine multi-stage journey into one large module",
    );
  });
});

describe("sequentialModuleRepairTarget", () => {
  it("repairs an empty or fully dropped list to a typical journey", () => {
    expect(
      sequentialModuleRepairTarget({
        validCount: 0,
        droppedCount: 0,
        packedSingle: false,
      }),
    ).toBe(3);
  });

  it("restores dropped sibling modules instead of keeping one leftover", () => {
    expect(
      sequentialModuleRepairTarget({
        validCount: 1,
        droppedCount: 2,
        packedSingle: false,
      }),
    ).toBe(3);
  });

  it("keeps a compact single-module plan", () => {
    expect(
      sequentialModuleRepairTarget({
        validCount: 1,
        droppedCount: 0,
        packedSingle: false,
      }),
    ).toBe(1);
  });
});

describe("goal curriculum plan module recovery", () => {
  const englishModule = {
    title: "Milestone Module 2 of 3",
    summary:
      "This is the second sequential milestone module in the three-part project sequence.",
    objective: "Demonstrate a generic sequential milestone.",
    plannedOutcomes: ["Complete this milestone"],
    entryFoundationBriefs: [],
    exitCapabilityBriefs: ["Finish the milestone"],
    estimatedUnitCount: 4,
    unitPlanningBrief: {
      scopeSize: "standard" as const,
      rationale: "Four focused lessons cover this milestone.",
      progression: ["Build capability"],
    },
    dependsOnPrevious: "Builds on the previous milestone.",
  };
  const chineseModule = {
    ...englishModule,
    title: "掌握行列式的计算与核心性质",
    summary: "完成线性代数第一个核心工具的学习。",
    objective: "能够选择合适方法计算行列式并解释关键性质。",
    plannedOutcomes: ["计算常见行列式"],
    exitCapabilityBriefs: ["独立完成行列式化简"],
    dependsOnPrevious: "具备基本的高中代数运算能力。",
  };

  function moduleRepairCount(title: string, candidate: unknown) {
    const prepared = prepareGoalCurriculumPlanAuthoring({
      title,
      level: "basic",
      pathSource: "generic",
      contentLanguage: "zh-Hans",
    });
    const normalized = prepared.recoveryPolicy.normalize(candidate);
    const parsed = prepared.schema.safeParse(normalized.value);
    if (parsed.success) return 0;
    return prepared.recoveryPolicy
      .repairSlots({ candidate: normalized.value, error: parsed.error })
      .filter((repair) =>
        String(repair.slot.description).includes("sequential module"),
      ).length;
  }

  it("repairs off-language leftover modules instead of accepting one", () => {
    expect(
      moduleRepairCount("线性代数", {
        schemaVersion: 2,
        refinedTitle: "线性代数",
        domainAnalysis: {
          field: "数学",
          subdomain: "线性代数",
          learningMode: "conceptual_understanding",
          domainTag: "stem",
          topicCategory: "mathematics",
          modeClarification: "通过计算、几何解释与应用理解线性代数。",
          alternateInterpretations: [],
        },
        topicOverview: "从行列式与线性方程组逐步建立矩阵计算能力。",
        whatYouWillLearn: [
          "熟练计算行列式",
          "求解线性方程组",
          "解释矩阵变换",
        ],
        modules: [
          chineseModule,
          englishModule,
          { ...englishModule, title: "Milestone Module 3 of 3" },
        ],
        outOfScope: [],
        prerequisitesAssumed: [],
      }),
    ).toBe(2);
  });

  it("splits a packed single-module plan", () => {
    expect(
      moduleRepairCount("高中物理", {
        schemaVersion: 2,
        refinedTitle: "高中物理",
        domainAnalysis: {
          field: "物理",
          subdomain: "高中物理",
          learningMode: "conceptual_understanding",
          domainTag: "stem",
          topicCategory: "natural_science",
          modeClarification: "按力学到电磁学的能力里程碑学习高中物理。",
          alternateInterpretations: [],
        },
        topicOverview: "覆盖高中物理的完整能力进阶。",
        whatYouWillLearn: ["力学建模", "电磁学应用", "独立解题"],
        modules: [
          {
            ...chineseModule,
            title: "学完高中物理",
            summary: "把全部高中物理压进一个模块。",
            objective: "掌握高中物理全部主干能力。",
            estimatedUnitCount: 16,
            unitPlanningBrief: {
              scopeSize: "large",
              rationale: "This one module covers the whole subject.",
              progression: [
                "力学",
                "热学",
                "电磁学",
                "光学与近代物理",
              ],
            },
          },
        ],
        outOfScope: [],
        prerequisitesAssumed: [],
      }),
    ).toBe(2);
  });
});
