import { gatherGoalPathContext } from "./goal-path-context.js";
import { serializeMapPlan } from "./map-plan.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import { planGoalMapFromCurrentMapStream } from "../llm/plan-goal-map.js";
import type { GoalMapPlan } from "../llm/schemas.js";
import { goalHasRagDocuments } from "../rag/retrieve.js";
import { isMicroGoal } from "../domain/goal-kind.js";
import { appendLearnerProfileToPromptOptions } from "../persona/learner-profile.js";
import type { LearningGoalPlanRepository } from "../../../domain/src/index.js";
import {
  loadTeachingSkillPrompt,
  resolveTeachingSkillForGoal,
} from "../teaching-skills/index.js";

const inFlightRefreshes = new Map<string, Promise<GoalMapPlan | null>>();

type MapTreeUnit = {
  id: string;
  title: string;
  unitKind: string;
  difficulty: string;
  contentSummary: string;
  orderIndex: number;
  parentUnitId: string | null;
};

function formatCurrentMap(units: readonly MapTreeUnit[]): string {
  const childrenByParent = new Map<string | null, MapTreeUnit[]>();
  for (const unit of units) {
    const key = unit.parentUnitId ?? null;
    const list = childrenByParent.get(key) ?? [];
    list.push(unit);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  }

  const topLevelCount = childrenByParent.get(null)?.length ?? 0;
  const lessonUnits = units.filter((unit) => unit.unitKind === "lesson");
  const moduleCount = units.filter((unit) => unit.unitKind === "module").length;
  const lines: string[] = [
    `Actual map totals: ${topLevelCount} top-level units, ${moduleCount} modules, ${lessonUnits.length} lesson leaves.`,
  ];
  const walk = (parentId: string | null, depth: number) => {
    for (const unit of childrenByParent.get(parentId) ?? []) {
      const indent = "  ".repeat(depth);
      lines.push(
        `${indent}- ${unit.title} [${unit.unitKind}, ${unit.difficulty}]: ${unit.contentSummary}`,
      );
      walk(unit.id, depth + 1);
    }
  };
  walk(null, 0);
  return lines.join("\n");
}

async function runDetailedPlanRefresh(params: {
  goalId: string;
  userId: string;
  learningGoalPlan: LearningGoalPlanRepository;
  onToken?: (delta: string) => Promise<void> | void;
  signal?: AbortSignal;
}): Promise<GoalMapPlan | null> {
  const goal = await params.learningGoalPlan.findOwnedContext(
    params.userId,
    params.goalId,
  );
  if (!goal || goal.units.length === 0) return null;
  if (isMicroGoal(goal)) return null;

  const ownerId = params.userId;
  const started = await params.learningGoalPlan.beginOwnedDetailedPlanRefresh(
    ownerId,
    goal.id,
  );
  if (started.status === "not_found") return null;

  try {
    const hasRag = await goalHasRagDocuments(goal.id);
    const { context, pathSource } = await gatherGoalPathContext({
      goalId: goal.id,
      title: goal.title,
      hasUpload: hasRag,
      allowWebSearch: false,
    });
    const contentLanguage = resolveGoalContentLanguage(
      goal.contentLanguage,
      goal.title,
    );
    const generationOptions = await appendLearnerProfileToPromptOptions(
      goal.userId,
      goal.generationOptions,
    );
    await resolveTeachingSkillForGoal({
      goalId: goal.id,
      title: goal.title,
      level: goal.level,
      generationOptions,
      sourceSummary: context,
    });
    const teachingSkill = await loadTeachingSkillPrompt(
      goal.id,
      "goal_plan",
      `${goal.title} ${generationOptions}`,
    );
    const plan = await planGoalMapFromCurrentMapStream({
      title: goal.title,
      level: goal.level,
      currentMap: formatCurrentMap(goal.units),
      context,
      pathSource,
      contentLanguage,
      generationOptions,
      teachingSkillBlock: teachingSkill?.promptBlock,
      onToken: params.onToken,
      signal: params.signal,
    });

    const cognitiveState = await params.learningGoalPlan.findOwnedContext(
      ownerId,
      goal.id,
    );
    const cognitiveInputsFrozen = Boolean(
      cognitiveState?.cognitiveModelEnabled &&
      cognitiveState.cognitiveModelInputHash,
    );
    const planInput = {
      userId: ownerId!,
      goalId: goal.id,
      topicOverview: plan.topicOverview,
      mapPlanJson: serializeMapPlan(plan),
      ...(cognitiveInputsFrozen
        ? {}
        : {
            pathSource,
            domainTag: plan.domainAnalysis.domainTag,
            topicCategory: plan.domainAnalysis.topicCategory,
          }),
    };
    const published =
      await params.learningGoalPlan.publishOwnedDetailedPlan(planInput);
    if (published.status !== "updated") {
      throw new Error("Goal not found while publishing detailed plan");
    }
    return plan;
  } catch (e) {
    await params.learningGoalPlan.markOwnedDetailedPlanRefreshFailed(
      ownerId,
      goal.id,
    );
    throw e;
  }
}

export function refreshDetailedPlanForGoal(params: {
  goalId: string;
  userId: string;
  learningGoalPlan: LearningGoalPlanRepository;
  onToken?: (delta: string) => Promise<void> | void;
  signal?: AbortSignal;
}): Promise<GoalMapPlan | null> {
  const existing = inFlightRefreshes.get(params.goalId);
  if (existing) return existing;

  const refresh = runDetailedPlanRefresh(params).finally(() => {
    if (inFlightRefreshes.get(params.goalId) === refresh) {
      inFlightRefreshes.delete(params.goalId);
    }
  });
  inFlightRefreshes.set(params.goalId, refresh);
  return refresh;
}
