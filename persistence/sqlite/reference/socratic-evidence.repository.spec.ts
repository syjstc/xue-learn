import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmTaskAttemptRepository } from "./task-attempt.repository.ts";
import { MikroOrmVerifiedEvidenceAppendRepository } from "./verified-evidence-append.repository.ts";
import { MikroOrmSocraticEvidenceRepository } from "./socratic-evidence.repository.ts";

describe("MikroOrmSocraticEvidenceRepository", () => {
  class SqlitePlatform {}

  function repositoryWithResults(...results: unknown[]) {
    const execute = jest.fn();
    for (const result of results) execute.mockResolvedValueOnce(result);
    const em = {
      getConnection: () => ({
        execute,
        getPlatform: () => new SqlitePlatform(),
      }),
      getTransactionContext: () => undefined,
      config: { getSchema: () => undefined },
      schema: undefined,
    } as unknown as EntityManager;
    return {
      repository: new MikroOrmSocraticEvidenceRepository(em),
      execute,
    };
  }

  const input = {
    userId: "user-1",
    goalId: "goal-1",
    unitId: "unit-1",
    threadId: "thread-1",
    turn: 2,
    answer: "The assigned value is printed.",
    resolved: true,
    terminatedByLimit: false,
    task: {
      stableKey: "assessment:socratic:declaration",
      targetId: "target-1",
      title: "Guided correction · Variables",
      instructions: "Explain the result.",
      definitionVersion: 1,
      requirements: [
        {
          cognitiveEntityId: "entity-1",
          learningTargetId: "target-1",
          dimension: "understanding" as const,
          criterionRef: "target-1:c1",
          definitionVersion: 3,
          required: true,
          weight: 1,
          orderIndex: 0,
        },
        {
          cognitiveEntityId: "entity-1",
          dimension: "independence" as const,
          criterionRef: "system:assistance_independence:v1",
          definitionVersion: 3,
          required: false,
          weight: 1,
          orderIndex: 1,
          rubricCriterion: {
            text: "Degree of independent performance without guided prompts",
          },
        },
      ],
    },
  };

  it("rejects a unit outside the learner-owned goal scope", async () => {
    const { repository, execute } = repositoryWithResults([]);

    await expect(repository.record(input)).rejects.toMatchObject({
      code: "ownership_mismatch",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects an immutable task declaration change", async () => {
    const { repository, execute } = repositoryWithResults(
      [{ id: "unit-1", goalId: "goal-1", userId: "user-1" }],
      [{ id: "target-1", goalId: "goal-1", status: "active" }],
      [{ goalId: "goal-1", status: "active", definitionVersion: 3 }],
      [{ id: "target-1", goalId: "goal-1", status: "active" }],
      [{ id: "target-requirement-1" }],
      [{ goalId: "goal-1", status: "active", definitionVersion: 3 }],
      [
        {
          id: "task-1",
          unitId: "unit-1",
          taskType: "explanation",
          title: "Old title",
          instructions: "Explain the result.",
          context: {},
          definitionVersion: 1,
          origin: "socratic",
          status: "active",
        },
      ],
      [
        {
          id: "requirement-1",
          cognitiveEntityId: "entity-1",
          learningTargetId: "target-1",
          dimension: "understanding",
          rubricCriterion: {
            ref: "target-1:c1",
            definitionVersion: 3,
          },
          required: true,
          weight: 1,
          orderIndex: 0,
        },
        {
          id: "requirement-2",
          cognitiveEntityId: "entity-1",
          learningTargetId: null,
          dimension: "independence",
          rubricCriterion: {
            ref: "system:assistance_independence:v1",
            definitionVersion: 3,
            text: "Degree of independent performance without guided prompts",
          },
          required: false,
          weight: 1,
          orderIndex: 1,
        },
      ],
    );

    await expect(
      repository.record({
        ...input,
        task: { ...input.task, title: "New title" },
      }),
    ).rejects.toMatchObject({ code: "immutable_declaration" });
    expect(execute).toHaveBeenCalledTimes(8);
  });

  it("declares both Socratic dimensions and uses the thread-turn attempt key", async () => {
    const { repository, execute } = repositoryWithResults(
      [{ id: "unit-1", goalId: "goal-1", userId: "user-1" }],
      [{ id: "target-1", goalId: "goal-1", status: "active" }],
      [{ goalId: "goal-1", status: "active", definitionVersion: 3 }],
      [{ id: "target-1", goalId: "goal-1", status: "active" }],
      [{ id: "target-requirement-1" }],
      [{ goalId: "goal-1", status: "active", definitionVersion: 3 }],
      [],
      [],
      [{ id: "task-1" }],
      [],
      [],
      [],
      [
        {
          id: "requirement-1",
          cognitiveEntityId: "entity-1",
          learningTargetId: "target-1",
          dimension: "understanding",
          rubricCriterion: {
            ref: "target-1:c1",
            definitionVersion: 3,
          },
          required: true,
          weight: 1,
          orderIndex: 0,
        },
        {
          id: "requirement-2",
          cognitiveEntityId: "entity-1",
          learningTargetId: null,
          dimension: "independence",
          rubricCriterion: {
            ref: "system:assistance_independence:v1",
            definitionVersion: 3,
            text: "Degree of independent performance without guided prompts",
          },
          required: false,
          weight: 1,
          orderIndex: 1,
        },
      ],
    );
    const start = jest
      .spyOn(MikroOrmTaskAttemptRepository.prototype, "start")
      .mockResolvedValue({
        attempt: {
          id: "attempt-1",
          taskId: "task-1",
          userId: "user-1",
          unitId: "unit-1",
        } as never,
        replayed: false,
      });
    const append = jest
      .spyOn(
        MikroOrmVerifiedEvidenceAppendRepository.prototype,
        "recordVerifiedObservation",
      )
      .mockResolvedValue({} as never);

    await expect(repository.record(input)).resolves.toEqual({
      observationCount: 2,
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "assessment:socratic:thread-1:2",
        assistanceLevel: 0.55,
        hintCount: 2,
        status: "evaluated",
      }),
    );
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls.map(([call]) => call.candidate.score)).toEqual([
      0.8, 0.3,
    ]);
    expect(
      execute.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO "TaskRequirement"'),
      ),
    ).toHaveLength(2);

    start.mockRestore();
    append.mockRestore();
  });
});
