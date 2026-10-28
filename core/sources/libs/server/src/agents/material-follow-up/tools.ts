import { createLearningGuidanceTools } from "../../learning-trajectory/tools.js";
import { z } from "zod";
import { createMicroCourseFromTopic } from "../../goals/create-micro-course-from-topic.js";
import { defineAgentTool } from "../core/tools.js";
import { retrieveOrSearchWebKnowledge } from "../../search/web-knowledge.js";
import { requireAgentConversationPersistence } from "../core/checkpoint.js";

export function createMaterialFollowUpTools(
  options: {
    userId?: string;
    goalId?: string;
    unitId?: string;
    contentLanguage?: string;
  } = {},
) {
  return [
    defineAgentTool({
      name: "search_web_knowledge",
      description:
        "Search and save current web knowledge when the question depends on current or version-specific information, needs web sources, or cannot be answered reliably from the lesson and reference material. Include the year from the system current-time block for time-sensitive queries.",
      schema: z.object({
        query: z
          .string()
          .min(2)
          .describe(
            "Web search query; include the current year for time-sensitive topics.",
          ),
        reason: z.string().min(2),
        freshnessClass: z
          .enum(["live", "rapid", "normal", "stable"])
          .optional(),
      }),
      handler: async (args, ctx) => {
        const unitId = ctx.toolSubject?.unitId ?? options.unitId;
        const goalId = ctx.toolSubject?.goalId ?? options.goalId;
        if (!unitId || !goalId) {
          throw new Error("Material follow-up tool scope is unavailable");
        }
        const targetIds =
          await requireAgentConversationPersistence().listUnitLearningTargetIds(
            unitId,
          );
        return retrieveOrSearchWebKnowledge({
          userId: ctx.userId,
          goalId,
          targetIds: [...targetIds],
          query: args.query,
          reason: args.reason,
          freshnessClass: args.freshnessClass,
          onActivity: async (activity) => {
            await ctx.send({ type: "knowledge_activity", activity });
          },
        });
      },
    }),

    ...(process.env.XUELEARN_DESKTOP_LOCAL === "1" ? createLearningGuidanceTools() : [defineAgentTool({
      name: "create_micro_course",
      description:
        "Create a micro-course when the learner's question is clearly outside the current lesson or goal, needs systematic study of a new topic, or explicitly requests a new topic.",
      schema: z.object({
        topic: z
          .string()
          .min(2)
          .describe(
            "New micro-course title, such as 'Japanese N5 fundamentals' or 'machine-learning basics'.",
          ),
        reason: z
          .string()
          .optional()
          .describe(
            "Internal note explaining why this deserves a separate micro-course.",
          ),
      }),
      handler: async (args, ctx) => {
        return createMicroCourseFromTopic(
          ctx.userId,
          args.topic,
          {
            send: ctx.send,
            signal: ctx.signal,
            threadId: ctx.threadId,
            traceId: ctx.traceId,
          },
          {
            contentLanguage:
              (ctx.state.contentLanguage as string | undefined) ??
              options.contentLanguage,
          },
        );
      },
      renderUi: (_args, result) => {
        const created = result as Awaited<
          ReturnType<typeof createMicroCourseFromTopic>
        >;
        return {
          uiKind: "micro_course_created",
          args: {
            title: created.title,
            goalId: created.goalId,
            unitId: created.unitId,
            href: created.navigateTo,
            isOverview: created.isOverview,
          },
        };
      },
    })]),
  ];
}
