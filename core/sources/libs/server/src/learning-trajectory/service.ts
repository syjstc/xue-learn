import { resolveLearningPositionInContext } from "./resolve-position.js";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_LEARNING_GUIDANCE_PREFERENCES,
  learningContentIdentity,
  resolveLearningBlock,
  type LearningBranchDraft,
  type LearningPosition,
  type LearningGuidancePreferences,
} from "../../../domain/src/index.js";
import {
  getUserSettingsForUser,
  upsertUserSettingsForUser,
} from "../user-settings.js";
import {
  learningTrajectoryEnabled,
  learningTrajectoryPersistence,
} from "./persistence.js";
import {
  cancelLearningSupplement,
  scheduleLearningSupplement,
} from "./generation.js";
import {
  learningPositionSchema,
  learningSupplementDraftSchema,
  type LearningGuidanceTurn,
  type LearningSupplementDraft,
} from "./contracts.js";

export async function learningGuidancePreferences(
  userId: string,
): Promise<LearningGuidancePreferences> {
  const settings = await getUserSettingsForUser(userId);
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(settings?.clientPreferencesJson ?? "{}");
  } catch {
    /* defaults */
  }
  const p = prefs.learningGuidance as
    Partial<LearningGuidancePreferences> | undefined;
  return {
    autoSaveSupplements: p?.autoSaveSupplements !== false,
    proactiveGuidance: p?.proactiveGuidance !== false,
  };
}
export async function saveLearningGuidancePreferences(
  userId: string,
  patch: Partial<LearningGuidancePreferences>,
) {
  const settings = await getUserSettingsForUser(userId);
  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(settings?.clientPreferencesJson ?? "{}");
  } catch {
    /* defaults */
  }
  const current = await learningGuidancePreferences(userId);
  const learningGuidance = { ...current, ...patch };
  const data = {
    clientPreferencesJson: JSON.stringify({ ...prefs, learningGuidance }),
  };
  await upsertUserSettingsForUser(userId, { create: data, update: data });
  return learningGuidance;
}
export async function resolveOwnedLearningPosition(
  userId: string,
  input: LearningPosition,
) {
  const position = learningPositionSchema.parse(input);
  const context = await learningTrajectoryPersistence().context(
    userId,
    position.unitId,
  );
  if (!context) throw new Error("Learning unit unavailable");
  return resolveLearningPositionInContext(context, position);
}
export async function beginLearningGuidanceTurn(input: {
  userId: string;
  unitId: string;
  threadId?: string;
  eventId: string;
  position: LearningPosition;
  sourceText: string;
  activeVisitId?: string;
}): Promise<LearningGuidanceTurn | undefined> {
  if (!learningTrajectoryEnabled()) return undefined;
  const result = await resolveOwnedLearningPosition(
    input.userId,
    input.position,
  );
  if (input.unitId !== input.position.unitId)
    throw new Error("Learning unit mismatch");
  const visit = input.activeVisitId
    ? await learningTrajectoryPersistence().visit(
        input.userId,
        input.activeVisitId,
      )
    : null;
  const activeVisitId =
    visit?.unitId === input.unitId && visit.state === "active"
      ? visit.id
      : undefined;
  const turn: LearningGuidanceTurn = {
    ...input,
    activeVisitId,
    position: result.position,
  };
  await learningTrajectoryPersistence().appendEvent(input.userId, {
    id: input.eventId,
    unitId: input.unitId,
    branchId: null,
    visitId: activeVisitId ?? null,
    threadId: input.threadId ?? null,
    kind: "question",
    text: input.sourceText,
    evidence: null,
    position: turn.position,
  });
  return turn;
}
export async function guidanceContext(turn: LearningGuidanceTurn) {
  const [prefs, snapshot] = await Promise.all([
    learningGuidancePreferences(turn.userId),
    learningTrajectoryPersistence().snapshot({
      userId: turn.userId,
      unitId: turn.unitId,
      limit: 12,
    }),
  ]);
  const active = turn.activeVisitId
    ? snapshot.visits.find(
        (v) => v.id === turn.activeVisitId && v.state !== "returned",
      )
    : undefined;
  return `Learning guidance preferences: ${JSON.stringify(prefs)}. Current learning visit: ${JSON.stringify(active ?? null)}.
Existing supplements (reuse, do not duplicate): ${JSON.stringify(snapshot.branches.map((b) => ({ id: b.id, title: b.title, purpose: b.purpose, status: b.status, deferred: b.deferred, returnGoal: b.returnGoal })))}.
Recent observed events (suggestions are NOT learning evidence): ${JSON.stringify(snapshot.events.map((e) => ({ kind: e.kind, text: e.text, evidence: e.evidence })))}.
A deferred supplement must not be suggested again without new relevant evidence or an explicit request. During a supplement, answer in place; never automatically create a nested supplement. Recommend returning only to help with the original question, without claiming mastery or requiring a test.`;
}
export async function saveLearningSupplement(
  turn: LearningGuidanceTurn,
  draft: LearningSupplementDraft,
) {
  if (!learningTrajectoryEnabled())
    throw new Error("Learning supplements unavailable");
  const parsed = learningSupplementDraftSchema.parse(draft);
  const context = await learningTrajectoryPersistence().context(
    turn.userId,
    turn.unitId,
  );
  if (
    [turn.unitId, context?.goalId, turn.activeVisitId].includes(
      parsed.returnGoal,
    )
  )
    throw new Error(
      "returnGoal must describe what the learner should understand on returning, not a database ID.",
    );
  const prefs = await learningGuidancePreferences(turn.userId);
  if (!prefs.autoSaveSupplements)
    throw new Error(
      "Automatic saving is disabled. Explain the concept in this conversation.",
    );
  if (turn.performedAction)
    throw new Error("This event already has a learning suggestion.");
  if (turn.responseOnly)
    throw new Error("This event only allows a conversational response.");
  turn.performedAction = true;
  const result = await learningTrajectoryPersistence().reserve(turn.userId, {
    ...parsed,
    id: randomUUID(),
    origin: turn.position,
    sourceEventId: turn.eventId,
    sourceThreadId: turn.threadId ?? null,
  });
  if (result.created) scheduleLearningSupplement(turn.userId, result.branch);
  return result.branch;
}
export async function proposeLearningGoal(
  turn: LearningGuidanceTurn,
  draft: Pick<LearningBranchDraft, "title" | "reason" | "returnGoal">,
) {
  if (turn.responseOnly)
    throw new Error("This event only allows a conversational response.");
  if (turn.performedAction)
    throw new Error("This event already has a learning suggestion.");
  turn.performedAction = true;
  const result = await learningTrajectoryPersistence().reserve(turn.userId, {
    ...draft,
    id: randomUUID(),
    origin: turn.position,
    sourceEventId: turn.eventId,
    sourceThreadId: turn.threadId ?? null,
    purpose: "interest",
    kind: "goal",
    topics: [],
  });
  return result.branch;
}
export async function learningBranchAction(
  userId: string,
  id: string,
  revision: number,
  action: "cancel" | "dismiss" | "defer" | "resume" | "retry",
) {
  if (action === "retry") {
    const b = await learningTrajectoryPersistence().claim(userId, id, revision);
    if (b) scheduleLearningSupplement(userId, b);
    return b;
  }
  const result = await learningTrajectoryPersistence().changeBranch({
    userId,
    id,
    revision,
    action,
  });
  if (result && (action === "cancel" || action === "dismiss"))
    cancelLearningSupplement(id);
  return result;
}
export async function learningBranchDetail(userId: string, id: string) {
  const repository = learningTrajectoryPersistence();
  const branch = await repository.branch(userId, id);
  if (!branch) return null;
  const context = await repository.context(userId, branch.unitId);
  const section = context?.sections.find((s) => s.id === branch.sectionId);
  return {
    branch,
    material:
      branch.status === "ready" && section
        ? {
            introduction: section.introduction,
            blocks: section.blocks,
            keyTakeaways: [],
          }
        : null,
  };
}
