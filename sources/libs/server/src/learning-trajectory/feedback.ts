import { randomUUID } from "node:crypto";
import {
  learningTrajectoryEnabled,
  learningTrajectoryPersistence,
} from "./persistence.js";
import { guidanceContext, learningGuidancePreferences } from "./service.js";
import type { LearningGuidanceTurn } from "./contracts.js";
import type {
  LearningPosition,
  LearningTrajectoryEvent,
} from "../../../domain/src/index.js";

const active = new Set<string>();
/** Only an explicit observed event reaches this boundary; navigation/scroll never calls it. */
export async function recordLearningFeedback(input: {
  userId: string;
  unitId: string;
  eventId: string;
  kind: "understood" | "content_finished" | "check" | "returned";
  visitId?: string;
  position?: LearningPosition;
  evidence?: LearningTrajectoryEvent["evidence"];
}) {
  if (!learningTrajectoryEnabled()) return;
  const repo = learningTrajectoryPersistence();
  const context = await repo.context(input.userId, input.unitId);
  if (!context) return;
  const visit = input.visitId
    ? await repo.visit(input.userId, input.visitId)
    : null;
  if (input.visitId && (!visit || visit.unitId !== input.unitId))
    throw new Error("Learning visit unavailable");
  const branch = visit ? await repo.branch(input.userId, visit.branchId) : null;
  const position = input.position ??
    visit?.position ??
    branch?.origin ?? { version: 1, unitId: input.unitId, mode: "reading" };
  const id = `feedback:${input.userId}:${input.eventId}`;
  const created = await repo.appendEvent(input.userId, {
    id,
    unitId: input.unitId,
    branchId: branch?.id ?? null,
    visitId: visit?.id ?? null,
    threadId: branch?.sourceThreadId ?? null,
    kind: input.kind,
    text: "",
    evidence: input.evidence ?? null,
    position,
  });
  if (
    !created ||
    !(await learningGuidancePreferences(input.userId)).proactiveGuidance
  )
    return;
  const turn: LearningGuidanceTurn = {
    userId: input.userId,
    unitId: input.unitId,
    eventId: id,
    position,
    sourceText: input.kind,
    activeVisitId: visit?.state === "active" ? visit.id : undefined,
    responseOnly: input.kind === "returned",
  };
  if (active.has(id)) return;
  active.add(id);
  // The grade/navigation response is independent of the provider request.
  void (async () => {
    const { runMaterialFollowUpAgent } =
      await import("../agents/material-follow-up/runner.js");
    const result = await runMaterialFollowUpAgent({
      userId: input.userId,
      unitId: input.unitId,
      goalId: context.goalId,
      unitTitle: context.unitTitle,
      goalTitle: context.goalTitle,
      lang: context.locale,
      contentLanguage: context.locale,
      anchorSnippet: position.anchorText ?? "",
      history: [],
      userMessage: `Observed learning event: ${input.kind}. Evidence: ${JSON.stringify(input.evidence ?? null)}. ${branch ? `Optional supplement: ${branch.title}. Return goal: ${branch.returnGoal}.` : ""} Give at most one short useful suggestion in one or two sentences. Read-finished and self-report are not mastery. A single wrong answer warrants explanation or one short question, never automatic remediation. Only multiple consistent server-observed failures or an explicit foundation gap justify saving a supplement. On returned, connect the supplement back to the original question, without another supplement or navigation. If no useful advice, reply with an empty message.`,
      moduleContext: await guidanceContext(turn),
      learningGuidance: turn,
      traceId: randomUUID(),
      signal: AbortSignal.timeout(300000),
      send: async () => undefined,
    });
    if (result.content.trim() && !turn.performedAction)
      await repo.appendEvent(input.userId, {
        id: `advice:${id}`,
        unitId: input.unitId,
        branchId: branch?.id ?? null,
        visitId: visit?.id ?? null,
        threadId: branch?.sourceThreadId ?? null,
        kind: "suggestion",
        text: result.content.slice(0, 1000),
        evidence: null,
        position,
      });
  })()
    .catch(() => undefined)
    .finally(() => active.delete(id));
}
