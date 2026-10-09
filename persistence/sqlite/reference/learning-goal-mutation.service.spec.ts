import type {
  AppendEventOutboxInput,
  EventOutboxRecord,
  LearningGoalRecord,
  LearningGoalRepository,
  LearningUnitRecord,
  LearningUnitRepository,
  ScopedMemoryPort,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { COGNITIVE_MODEL_SKELETON_EVENT } from "@xue-learn/core/source/libs/server/src/cognitive-model/event-types.ts";
import { computeCognitiveModelInputHash } from "@xue-learn/core/source/libs/server/src/cognitive-model/pure.ts";
import {
  LearningGoalMutationService,
  type LearningGoalMutationRepositories,
} from "./learning-goal-mutation.service.ts";

function makeGoal(
  overrides: Partial<LearningGoalRecord> = {},
): LearningGoalRecord {
  return {
    id: "goal-1",
    userId: "user-1",
    parentGoalId: null,
    title: "Learn TypeScript",
    level: "beginner",
    domainTag: "programming",
    topicCategory: "general",
    contentLanguage: "en",
    teachingPersonaRef: null,
    generationOptions: "{}",
    goalKind: "full",
    learningMode: "mastery",
    learningModeTransitionStatus: "idle",
    learningModeTransitionToken: null,
    learningModeTransitionStartedAt: null,
    learningModeTransitionError: "",
    learningModeTransitionArtifacts: {},
    planningMode: "fast",
    curriculumVersion: 2,
    status: "active",
    pathSource: "generic",
    topicOverview: "",
    mapSummaryJson: "{}",
    mapSummaryStatus: "ready",
    mapPlanJson: "{}",
    mapPlanStatus: "approved",
    detailedPlanStatus: "ready",
    cognitiveModelEnabled: true,
    cognitiveModelStatus: "ready",
    cognitiveModelVersion: 3,
    cognitiveModelInputHash: "old-hash",
    cognitiveModelPublishedHash: "old-hash",
    iconSvg: "",
    iconTint: "",
    goalRelationType: null,
    goalRelationContextJson: null,
    overviewCourseStatus: "ready",
    shareVisibility: "off",
    activeShareId: null,
    createdAt: new Date("2026-08-09T00:00:00.000Z"),
    updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    ...overrides,
  };
}

function makeUnit(
  overrides: Partial<LearningUnitRecord> = {},
): LearningUnitRecord {
  return {
    id: "unit-1",
    goalId: "goal-1",
    curriculumKey: "lesson-1",
    parentUnitId: null,
    unitKind: "lesson",
    title: "Types",
    contentSummary: "Types and annotations",
    orderIndex: 0,
    difficulty: "beginner",
    prerequisites: "[]",
    planAreaRef: "area-1",
    planningOutcomeRefs: ["outcome-1"],
    cognitiveModelStatus: "expanded",
    cognitiveModelBuildStartedAt: null,
    cognitiveModelBuildToken: null,
    cognitiveModelBuildInputHash: "old-hash",
    ...overrides,
  };
}

function makeEvent(input: AppendEventOutboxInput): EventOutboxRecord {
  const createdAt = input.createdAt ?? new Date("2026-08-09T00:00:00.000Z");
  return {
    id: input.id,
    type: input.type,
    payload: input.payload,
    createdAt,
    publishedAt: null,
    attemptCount: 0,
    nextAttemptAt: createdAt,
    lastError: null,
    deadLetteredAt: null,
  };
}

function fakeRepositories(input: {
  goal: LearningGoalRecord | null;
  units?: readonly LearningUnitRecord[];
  order?: string[];
}) {
  const order = input.order ?? [];
  const updates: unknown[] = [];
  const invalidations: unknown[] = [];
  const events: AppendEventOutboxInput[] = [];
  const memoryDeletes: unknown[] = [];
  const goalDeletes: unknown[] = [];
  let goal = input.goal;

  const learningGoal: LearningGoalRepository = {
    listOwned: async () => (goal ? [goal] : []),
    findOwnedById: async () => goal,
    create: async () => {
      throw new Error("not used");
    },
    updateOwned: async (_userId, _goalId, patch) => {
      order.push("goal.update");
      updates.push(patch);
      goal = goal ? { ...goal, ...patch, updatedAt: new Date() } : null;
      return goal;
    },
    deleteOwned: async () => {
      order.push("goal.delete");
      goalDeletes.push(true);
      return goal !== null;
    },
  };
  const learningUnit: LearningUnitRepository = {
    listForCurriculum: async () => input.units ?? [],
    invalidateCognitiveModel: async (value) => {
      order.push("unit.invalidate");
      invalidations.push(value);
      return { resetCount: 1, preservedExpandedCount: 1 };
    },
  };
  const scopedMemory: ScopedMemoryPort = {
    deleteOwnedGoalScope: async (value) => {
      order.push("memory.delete");
      memoryDeletes.push(value);
      return { recordsDeleted: 1, candidatesDeleted: 1 };
    },
  };
  const eventOutbox = {
    append: async (value: AppendEventOutboxInput) => {
      order.push("event.append");
      events.push(value);
      return makeEvent(value);
    },
  };
  return {
    repositories: {
      learningGoal,
      learningUnit,
      scopedMemory,
      eventOutbox,
    } satisfies LearningGoalMutationRepositories,
    updates,
    invalidations,
    events,
    memoryDeletes,
    goalDeletes,
    order,
  };
}

describe("learning goal mutation service", () => {
  it("invalidates v2 curriculum, preserves expanded units, and emits once per hash change", async () => {
    const goal = makeGoal();
    const units = [
      makeUnit(),
      makeUnit({
        id: "unit-2",
        curriculumKey: "lesson-2",
        orderIndex: 1,
        cognitiveModelStatus: "building",
        cognitiveModelBuildInputHash: null,
      }),
      makeUnit({
        id: "overview-1",
        curriculumKey: "overview",
        unitKind: "overview",
      }),
    ];
    const state = fakeRepositories({ goal, units });
    const service = new LearningGoalMutationService(state.repositories);

    const nextGoal = { ...goal, title: "Build TypeScript applications" };
    const expectedHash = computeCognitiveModelInputHash(
      nextGoal,
      units.filter((unit) => unit.unitKind !== "overview"),
    );

    await expect(
      service.updateOwnedSemantic({
        userId: "user-1",
        goalId: "goal-1",
        patch: {
          title: nextGoal.title,
          generationOptions: '{"coursePattern":"spiral"}',
        },
      }),
    ).resolves.toMatchObject({
      title: nextGoal.title,
      cognitiveModelEnabled: true,
      cognitiveModelInputHash: expectedHash,
      cognitiveModelStatus: "building",
    });

    expect(state.invalidations).toEqual([
      {
        goalId: "goal-1",
        nextInputHash: expectedHash,
        preserveExpanded: true,
      },
    ]);
    expect(state.updates).toEqual([
      expect.objectContaining({
        title: nextGoal.title,
        generationOptions: '{"coursePattern":"spiral"}',
        cognitiveModelInputHash: expectedHash,
        cognitiveModelStatus: "building",
      }),
    ]);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      type: COGNITIVE_MODEL_SKELETON_EVENT,
    });
    expect(JSON.parse(state.events[0]!.payload)).toEqual({
      goalId: "goal-1",
      inputHash: expectedHash,
      baseModelVersion: 3,
      reason: "curriculum_changed",
    });

    const unchanged = await service.updateOwnedSemantic({
      userId: "user-1",
      goalId: "goal-1",
      patch: { title: nextGoal.title },
    });
    expect(unchanged).toMatchObject({ title: nextGoal.title });
    expect(state.invalidations).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });

  it("cleans owned memory before deleting the goal and skips unowned goals", async () => {
    const state = fakeRepositories({ goal: makeGoal() });
    const service = new LearningGoalMutationService(state.repositories);

    await expect(
      service.deleteOwnedGoalScope({ userId: "user-1", goalId: "goal-1" }),
    ).resolves.toBe(true);
    expect(state.memoryDeletes).toEqual([
      { userId: "user-1", goalId: "goal-1" },
    ]);
    expect(state.order).toEqual(["memory.delete", "goal.delete"]);

    const unowned = fakeRepositories({ goal: null });
    const unownedService = new LearningGoalMutationService(
      unowned.repositories,
    );
    await expect(
      unownedService.deleteOwnedGoalScope({
        userId: "other-user",
        goalId: "goal-1",
      }),
    ).resolves.toBe(false);
    expect(unowned.memoryDeletes).toHaveLength(0);
    expect(unowned.goalDeletes).toHaveLength(0);
  });
});
