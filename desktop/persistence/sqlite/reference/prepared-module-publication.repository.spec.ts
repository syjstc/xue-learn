import type { EntityManager } from "@mikro-orm/core";
import type { PreparedModulePublicationRepository } from "@xue-learn/core/domain";
import { MikroOrmPreparedModulePublicationRepository } from "./prepared-module-publication.repository.ts";
import { DatabaseSync } from "node:sqlite";
import { mapPreparedMasteryPublication } from "@xue-learn/core/domain";

type Call = { sql: string; params: readonly unknown[] };

class SqlitePlatform {}

function fakeManager(results: readonly unknown[]): {
  manager: EntityManager;
  calls: Call[];
} {
  const calls: Call[] = [];
  let resultIndex = 0;
  const manager = {
    schema: "tenant_a",
    getTransactionContext: () => undefined,
    getConnection: () => ({
      getPlatform: () => new SqlitePlatform(),
      execute: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return results[resultIndex++];
      },
    }),
  } as unknown as EntityManager;
  return { manager, calls };
}

const input = {
  userId: "user-1",
  goalId: "goal-1",
  moduleId: "module-1",
  generationBuildToken: "lease-1",
  capabilities: [{ title: "capability", objective: "do" }],
  structure: {
    coverageRationale: "Build from foundations to practice.",
    units: [
      {
        title: "First lesson",
        contentSummary: "Start here.",
        difficulty: "easy" as const,
        capabilityRefs: ["capability"],
        milestoneRole: "introduce" as const,
      },
      {
        title: "Second lesson",
        contentSummary: "Apply it.",
        difficulty: "medium" as const,
        capabilityRefs: ["capability"],
        milestoneRole: "practice" as const,
      },
    ],
  },
  baseUnitPlanningBrief: { scope: "test" },
  publishedAt: new Date("2026-08-09T00:00:00.000Z"),
};

describe("prepared module publication reference repository", () => {
  it.each(["skill", "atom"] as const)("publishes a contracted %s with one stable identity and exact requirements in SQLite", async (kind) => {
    const db = new DatabaseSync(":memory:");
    const tables = {
      LearningModule: "id,goalId,generationBuildToken,unitPlanningBrief,generationVersion,entryFoundationStatus,entryFoundationError,generationBuildStartedAt,generationError,updatedAt",
      LearningUnit: "id,curriculumKey,goalId,moduleId,parentUnitId,unitKind,title,orderIndex,difficulty,contentSummary,planAreaRef,planningOutcomeRefs,moduleCapabilityRefs,moduleMilestoneRole,prerequisites,status,cognitiveModelStatus,requiredForModuleCompletion",
      CognitiveEntity: "id,stableKey,scopeKey,kind,scope,goalId,title,description,language,definitionVersion,status,provenance,createdAt,updatedAt",
      KnowledgeAtom: "entityId,atomType,statement,explanation,boundary,assessmentHints",
      CognitiveConstruct: "entityId,constructType,objective,performanceCriteria,contextSchema,inputs,outputs,qualityCriteria,compositionStrategy",
      LearningTarget: "id,goalId,stableKey,title,explanation,learningObjective,assessmentCriteria,language,definitionVersion,importance,importanceWeight,difficulty,targetCognitiveLevel,rationale,planningOutcomeRefs,origin,status,introducedModelVersion,createdAt,updatedAt",
      LearningTargetRequirement: "id,learningTargetId,cognitiveEntityId,requirementType,dimension,required,threshold,gate,weight,orderIndex,rationale,createdAt",
      ModuleLearningTarget: "id,moduleId,learningTargetId,localRef,required,weight,orderIndex,role",
      CognitiveRelation: "id,ownerCurriculumKey,sourceEntityId,targetEntityId,relationType,strength,required,rationale,status,introducedModelVersion,createdAt,updatedAt",
    };
    for (const [table, columns] of Object.entries(tables)) {
      db.exec(`CREATE TABLE "${table}" (${columns.split(",").map((column) => `"${column}"`).join(",")})`);
    }
    db.exec(`CREATE UNIQUE INDEX stable_entity ON CognitiveEntity(goalId,stableKey)`);
    db.prepare("INSERT INTO LearningModule(id,goalId,generationBuildToken,unitPlanningBrief,generationVersion) VALUES (?,?,?,?,0)")
      .run("module-1", "goal-1", "lease-1", "{}");
    const manager = {
      getTransactionContext: () => undefined,
      getConnection: () => ({
        execute: async (sql: string, params: any[] = []) => db.prepare(sql).all(...params.map((value) =>
          value instanceof Date ? value.toISOString() : typeof value === "boolean" ? Number(value) : value,
        )),
      }),
    } as unknown as EntityManager;
    const prepared = mapPreparedMasteryPublication({
      moduleCurriculumKey: "module-key", entryFoundationBriefs: [],
      capabilities: [{ title: "Use the rule", objective: "Apply the rule in scope.",
        assessmentCriteria: ["Correct result"], dimensions: ["understanding", "application"],
        criticalCompletionGate: true, cognitiveLevel: "apply", difficulty: "easy",
        semanticKey: "rule.apply", entityKind: kind, threshold: 0.82 }],
      units: [{ title: "Rule", contentSummary: "Apply the rule", difficulty: "easy",
        capabilityRefs: ["mc_1"], milestoneRole: "verify" }],
      coverageRationale: "The lesson demonstrates the rule.",
    });
    const request = {
      userId: "user-1", goalId: "goal-1", moduleId: "module-1", generationBuildToken: "lease-1",
      orderIndex: 0, curriculumKey: "module-key", contentLanguage: "en", mapOutcomeCount: 1,
      foundations: prepared.foundations, capabilities: prepared.capabilities, units: prepared.units,
      preparedExisting: false, publishedAt: new Date("2026-10-20T00:00:00Z"),
    };
    try {
      const repository = new MikroOrmPreparedModulePublicationRepository(manager);
      await repository.publishMastery(request);
      const first = db.prepare("SELECT id,stableKey,kind FROM CognitiveEntity").get();
      expect(first).toMatchObject({ stableKey: "path:rule.apply", kind });
      expect(db.prepare("SELECT threshold FROM LearningTargetRequirement").all()).toEqual([
        { threshold: 0.82 }, { threshold: 0.82 },
      ]);
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${kind === "atom" ? "KnowledgeAtom" : "CognitiveConstruct"}`).get()).toEqual({ count: 1 });
      await repository.publishMastery({ ...request, preparedExisting: true });
      expect(db.prepare("SELECT id,stableKey,kind FROM CognitiveEntity").all()).toEqual([first]);
    } finally {
      db.close();
    }
  });

  it("publishes lesson structure and fences the generation lease", async () => {
    const state = fakeManager([
      [{ id: "goal-1" }],
      [
        {
          id: "module-1",
          goalId: "goal-1",
          orderIndex: 1,
          generationBuildToken: "lease-1",
          generationVersion: 2,
          unitPlanningBrief: {},
        },
      ],
      [],
      undefined,
      undefined,
      [{ generationVersion: 3 }],
    ]);
    const repository: PreparedModulePublicationRepository =
      new MikroOrmPreparedModulePublicationRepository(state.manager);

    await expect(repository.publish(input)).resolves.toEqual({
      moduleId: "module-1",
      published: true,
      createdUnitCount: 2,
      generationVersion: 3,
    });
    expect(state.calls).toHaveLength(6);
    expect(state.calls[0].sql).toContain('FROM "tenant_a"."LearningGoal"');
    expect(state.calls[3].sql).toContain(
      'INSERT INTO "tenant_a"."LearningUnit"',
    );
    expect(state.calls[3].params).toContain("First lesson");
    expect(state.calls[5].sql).toContain('"generationBuildToken" = NULL');
    expect(state.calls[5].params).toContain("lease-1");
    expect(state.calls[5].params).toContain(
      JSON.stringify({
        scope: "test",
        preparedMasteryModule: {
          capabilities: input.capabilities,
          structure: input.structure,
        },
      }),
    );
  });

  it("rejects a superseded lease before inserting units", async () => {
    const state = fakeManager([
      [{ id: "goal-1" }],
      [
        {
          id: "module-1",
          goalId: "goal-1",
          generationBuildToken: "newer-lease",
          generationVersion: 2,
        },
      ],
    ]);
    const repository = new MikroOrmPreparedModulePublicationRepository(
      state.manager,
    );

    await expect(repository.publish(input)).rejects.toThrow(
      "Module generation lease was superseded",
    );
    expect(state.calls).toHaveLength(2);
  });
});
