import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmCognitiveEntityEvidenceReadRepository } from "./cognitive-entity-evidence-read.repository.ts";

describe("MikroOrmCognitiveEntityEvidenceReadRepository", () => {
  const observedAt = new Date("2020-08-10T00:00:00.000Z");
  const createdAt = new Date("2020-08-10T00:01:00.000Z");

  function repositoryWithResults(...results: unknown[]) {
    const execute = jest.fn();
    for (const result of results) execute.mockResolvedValueOnce(result);
    const em = {
      getConnection: () => ({ execute }),
      config: { getSchema: () => undefined },
      schema: undefined,
    } as unknown as EntityManager;
    return {
      repository: new MikroOrmCognitiveEntityEvidenceReadRepository(em),
      execute,
    };
  }

  it("assembles scoped claims with lifecycle status through the ORM boundary", async () => {
    const { repository, execute } = repositoryWithResults(
      [
        {
          scope: "goal",
          ownerUserId: null,
          goalUserId: "user-1",
        },
      ],
      [
        {
          id: "claim-1",
          userId: "user-1",
          cognitiveEntityId: "entity-1",
          dimension: "memory",
          criterionRef: "criterion-1",
          score: 0.8,
          strength: 1,
          evaluatorReliability: 1,
          groundingReliability: 1,
          definitionVersion: 1,
          contextKey: "unit-1",
          status: "active",
          validFrom: createdAt,
          validUntil: null,
          createdAt,
          entityKind: "atom",
          metadata: JSON.stringify({
            evidenceSource: "quiz",
            evidenceTaskKind: "recall",
            contextDistance: "same",
            evidenceStrength: "moderate",
            assistance: {
              level: "independent",
              hintCount: 0,
              answerRevealed: false,
            },
          }),
          evaluatorType: "deterministic",
          observedAt,
          attemptId: "attempt-1",
          taskId: "task-1",
          durationMs: null,
          artifactRefs: JSON.stringify([]),
          taskTitle: "Recall task",
          taskContext: JSON.stringify({
            evidencePolicy: {
              source: "quiz",
              taskKind: "recall",
              contextKey: "unit-1",
              contextDistance: "same",
            },
          }),
        },
      ],
      [
        {
          id: "lifecycle-0",
          evidenceClaimId: "claim-1",
          eventType: "created",
          reason: "",
          createdAt,
        },
        {
          id: "lifecycle-1",
          evidenceClaimId: "claim-1",
          eventType: "retracted",
          reason: "superseded",
          createdAt,
        },
      ],
    );

    await expect(
      repository.findForEntity({
        userId: "user-1",
        cognitiveEntityId: "entity-1",
      }),
    ).resolves.toEqual({
      claims: [
        expect.objectContaining({
          id: "claim-1",
          entityId: "entity-1",
          source: "quiz",
          taskKind: "recall",
          taskTitle: "Recall task",
          lifecycleStatus: "retracted",
          explanation: "superseded",
          taskId: "task-1",
          attemptId: "attempt-1",
          observedAt: observedAt.toISOString(),
        }),
      ],
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[0][1]).toEqual(["entity-1"]);
    expect(execute.mock.calls[1][1]).toEqual(["user-1", "entity-1"]);
    expect(execute.mock.calls[2][1]).toEqual(["claim-1"]);
  });

  it("returns null without reading claims for an entity outside the learner scope", async () => {
    const { repository, execute } = repositoryWithResults([
      {
        scope: "goal",
        ownerUserId: null,
        goalUserId: "another-user",
      },
    ]);

    await expect(
      repository.findForEntity({
        userId: "user-1",
        cognitiveEntityId: "entity-1",
      }),
    ).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
