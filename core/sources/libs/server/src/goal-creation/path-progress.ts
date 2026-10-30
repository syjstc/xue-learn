import { tBackend } from "../../../common/src/index.js";
import type { AgentSseEvent } from "../agents/core/types.js";
import type { GoalMapPlan } from "../llm/schemas.js";
import { buildPlanningOutlineEvent } from "../goals/deep-planning-research.js";

export function createPathProgressReporter(
  send: (
    event: Extract<
      AgentSseEvent,
      { type: "planning_activity" | "planning_outline" }
    >,
  ) => Promise<void>,
) {
  const started = Date.now();
  let sequence = 0;
  return async (progress: {
    moduleTitles: string[];
    unitCount: number;
    complete: boolean;
    plan?: GoalMapPlan;
  }) => {
    await send({
      type: "planning_activity",
      id: "goal_capability_path",
      sequence: sequence++,
      category: progress.complete ? "validation" : "synthesis",
      status: progress.complete ? "complete" : "active",
      elapsedSeconds: Math.floor((Date.now() - started) / 1000),
      capabilityPath: {
        moduleTitles: progress.moduleTitles,
        unitCount: progress.unitCount,
      },
      message: tBackend(
        progress.complete
          ? "status.planning.path.checked"
          : "status.planning.path.progress",
        {
          modules: progress.moduleTitles.length,
          units: progress.unitCount,
          assumptions: progress.plan?.learningPath?.baseline.length ?? 0,
        },
      ),
    });
    if (progress.plan) await send(buildPlanningOutlineEvent(progress.plan));
  };
}
