import { z } from "zod";
import { loadCheckpoint, saveCheckpoint } from "../../core/checkpoint.js";
import { defineAgentTool } from "../../core/tools.js";
import { resumeEmbeddedGoalCreation } from "../embedded.js";

export function createResumeGoalCreationTool() {
  return defineAgentTool({
    name: "resume_goal_creation",
    description:
      "用户想继续之前暂停的目标创建/摘要审核/地图生成流程时调用，把对话交回目标创建子 agent",
    schema: z.object({}),
    handler: async (_args, ctx) => {
      const checkpoint = await loadCheckpoint(ctx.threadId);
      if (!checkpoint.goalCreationActive || !checkpoint.goalCreationPaused) {
        return { resumed: false, reason: "goal_creation_not_paused" };
      }
      await saveCheckpoint(
        ctx.threadId,
        resumeEmbeddedGoalCreation(checkpoint, {
          reason: "resume_goal_creation",
        }),
      );
      return { resumed: true };
    },
  });
}
