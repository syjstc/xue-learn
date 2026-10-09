import {
  isTopicCategory,
  normalizeTopicCategory,
  type TopicCategory,
} from "../../../common/src/index.js";
import { parseMapPlan } from "./map-plan.js";

type GoalTopicCategorySource = {
  topicCategory?: string | null;
  mapPlanJson?: string | null;
};

/** Resolve persisted topic category, falling back to approved map plan JSON. */
export function resolveGoalTopicCategory(
  goal: GoalTopicCategorySource,
  fallback: TopicCategory = "general",
): TopicCategory {
  if (isTopicCategory(goal.topicCategory)) {
    return goal.topicCategory;
  }

  const plan = goal.mapPlanJson ? parseMapPlan(goal.mapPlanJson) : null;
  const fromPlan = plan?.domainAnalysis.topicCategory;
  return normalizeTopicCategory(fromPlan, fallback);
}
