import { z } from "zod";
import { FEATURE_GOAL_CREATION } from "../../features.js";
import { defineAgentTool } from "../core/tools.js";
import { loadCheckpoint } from "../core/checkpoint.js";
import {
  isCasualChitchat,
  isGoalCreationHowToQuestion,
  resolveEmbeddedGoalCreationStart,
  startEmbeddedGoalCreation,
} from "../goal-creation/embedded.js";
import { createResumeGoalCreationTool } from "../goal-creation/subagents/resume.js";

export type GlobalAssistantActionToolKey =
  "navigate" | "create_goal" | "resume_goal_creation";

export function createGlobalAssistantTools(
  options: {
    goalCreationPaused?: boolean;
    selectedToolKeys?: readonly GlobalAssistantActionToolKey[];
  } = {},
) {
  const selected = new Set(options.selectedToolKeys ?? []);
  const tools = [];

  if (selected.has("navigate")) {
    tools.push(
      defineAgentTool({
        name: "navigate",
        description:
          "Show a safe in-app navigation action for a known application path.",
        schema: z.object({
          path: z.string(),
          label: z.string().optional(),
        }),
        handler: async (args) => ({ path: args.path, label: args.label }),
        renderUi: (args) => ({
          uiKind: "action_buttons",
          args: {
            actions: [
              {
                kind: "link",
                label: args.label ?? "打开页面",
                href: args.path,
                variant: "primary",
              },
            ],
          },
        }),
      }),
    );
  }

  if (FEATURE_GOAL_CREATION && selected.has("create_goal")) {
    tools.push(
      defineAgentTool({
        name: "create_goal",
        description:
          "Start the goal-creation subflow only when the learner provided a concrete topic or explicitly requested creation.",
        schema: z.object({
          seedTopic: z.string().optional(),
        }),
        handler: async (args, ctx) => {
          const checkpoint = await loadCheckpoint(ctx.threadId);
          const lastUserMessage = [...checkpoint.llmMessages]
            .reverse()
            .find((message) => message.role === "user")?.content;
          if (isCasualChitchat(lastUserMessage)) {
            return {
              activated: false,
              skipped: true,
              reason: "casual_chitchat",
            };
          }
          if (isGoalCreationHowToQuestion(lastUserMessage)) {
            return {
              activated: false,
              skipped: true,
              reason: "how_to_question",
            };
          }
          const explicitStart =
            resolveEmbeddedGoalCreationStart(lastUserMessage);
          if (!explicitStart.start) {
            return {
              activated: false,
              suggested: true,
              seedTopic: args.seedTopic?.trim() || null,
            };
          }
          const { reset } = await startEmbeddedGoalCreation(
            ctx.threadId,
            explicitStart.seed ?? args.seedTopic?.trim(),
            { send: ctx.send },
          );
          return { activated: true, reset, seedTopic: args.seedTopic ?? null };
        },
        renderUi: (_args, result) => {
          const data = result as {
            suggested?: boolean;
            seedTopic?: string | null;
          };
          if (!data.suggested) return null;
          return {
            uiKind: "action_buttons",
            args: {
              title: "要把这个想法变成学习目标吗？",
              actions: [
                {
                  kind: "client",
                  clientAction: "start_goal_creation",
                  label: "创建这个目标",
                  value: data.seedTopic
                    ? { topic: data.seedTopic }
                    : "start_goal_creation",
                  variant: "primary",
                },
              ],
            },
          };
        },
      }),
    );
  }

  if (
    FEATURE_GOAL_CREATION &&
    options.goalCreationPaused &&
    selected.has("resume_goal_creation")
  ) {
    tools.push(createResumeGoalCreationTool());
  }

  return tools;
}
