import type { TranslationKey } from "@xue-learn/core/i18n";
import type { GoalCreationSessionEvent } from "./goal-creation-session.ts";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

const LIFECYCLE_EVENT_TYPES = new Set([
  "session_created",
  "legacy_session_adopted",
]);

const PLANNING_STAGES: Record<string, TranslationKey> = {
  analyzing_goal: "planning.stageAnalyzingGoal",
  searching_web: "planning.stageSearchingWeb",
  reading_sources: "planning.stageReadingSources",
  cross_checking: "planning.stageCrossChecking",
  researching_modules: "planning.stageResearchingModules",
  sequencing_modules: "planning.stageSequencingModules",
  revising_plan: "planning.stageRevisingPlan",
  validating_plan: "planning.stageValidatingPlan",
};

export function goalCreationEventText(
  type: string,
  payload: Record<string, unknown>,
  t: Translate,
): string | null {
  if (["paused", "pause_requested", "resumed"].includes(type)) return null;
  if (type === "reasoning_status") {
    if (payload.status === "active") return t("goalCreation.reasoningActive");
    if (payload.status === "requested")
      return t("goalCreation.reasoningRequested");
    if (payload.status === "unsupported")
      return t("goalCreation.reasoningWorking");
    return null;
  }
  if (type === "planning_outline" && Array.isArray(payload.modules)) {
    const titles = payload.modules
      .map((module) =>
        module && typeof module === "object" && "title" in module
          ? String(module.title)
          : "",
      )
      .filter(Boolean);
    if (titles.length)
      return t("goalCreation.preliminaryPlan", { titles: titles.join(" · ") });
  }
  if (type === "planning_stage" && typeof payload.stage === "string") {
    return (
      (typeof payload.message === "string" && payload.message.trim()) ||
      (PLANNING_STAGES[payload.stage]
        ? t(PLANNING_STAGES[payload.stage]!)
        : t("goalCreation.nextPlanningStage"))
    );
  }
  if (type === "module_research_progress") {
    const title =
      typeof payload.moduleTitle === "string"
        ? payload.moduleTitle
        : t("goalCreation.courseModule");
    const count =
      typeof payload.sourceCount === "number"
        ? ` · ${t("planning.sources", { count: payload.sourceCount })}`
        : "";
    if (payload.status === "complete")
      return t("goalCreation.moduleResearchComplete", { title, count });
    if (payload.status === "warning")
      return t("goalCreation.moduleResearchWarning", { title });
    return t("goalCreation.moduleResearching", { title, count });
  }
  if (type === "module_stage") {
    const title =
      typeof payload.moduleTitle === "string" && payload.moduleTitle.trim()
        ? payload.moduleTitle
        : t("goalCreation.courseModule");
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    const stage = typeof payload.stage === "string" ? payload.stage : "";
    if (stage === "researching" || stage === "authoring") {
      return t("goalCreation.moduleDrafting", { title });
    }
    if (stage === "audit" || stage === "validating") {
      return t("goalCreation.moduleAuditing");
    }
    if (stage === "publishing") {
      return t("goalCreation.modulePublishing", { title });
    }
    if (stage === "ready") {
      return t("goalCreation.modulePublished", { title });
    }
  }
  for (const key of ["message", "label", "query", "warning"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const labels: Record<string, TranslationKey> = {
    session_created: "goalCreation.workspaceReady",
    legacy_session_adopted: "goalCreation.resumed",
    planning_outline: "goalCreation.outlineReady",
    research_query: "goalCreation.researching",
    module_research_progress: "goalCreation.researching",
    planning_stage: "goalCreation.nextPlanningStage",
    planning_activity: "goalCreation.thinking",
    stopped: "goalCreation.stopped",
    completed: "goalCreation.firstLessonReady",
  };
  return labels[type] ? t(labels[type]!) : null;
}

/** Keep initialization bookkeeping out of learner-facing progress messages. */
export function isMeaningfulGoalCreationEvent(
  type: string,
  payload: Record<string, unknown> = {},
): boolean {
  if (LIFECYCLE_EVENT_TYPES.has(type)) return false;
  return !(type === "status" && payload.phase === "goal_creation");
}

export function latestLiveGoalCreationMessage(
  events: Array<GoalCreationSessionEvent & { text: string }>,
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (
      event.type === "planning_activity" &&
      event.payload.status === "complete"
    ) {
      continue;
    }
    if (event.text.trim()) return event.text;
  }
  return undefined;
}
