import { z } from "zod";
export const learningPositionSchema = z.object({
  version: z.literal(1),
  unitId: z.string().min(1).max(160),
  sectionId: z.string().max(160).optional(),
  topicId: z.string().max(160).optional(),
  topicTitle: z.string().max(300).optional(),
  blockIdentity: z.string().max(160).optional(),
  blockIndex: z.number().int().min(0).optional(),
  contentRevision: z.number().int().min(0).optional(),
  anchorText: z.string().max(2000).optional(),
  scrollOffset: z.number().finite().min(-10000).max(1000000).optional(),
  mode: z.enum(["reading", "classroom"]),
  readingPage: z.object({
    renderer: z.literal("godot"),
    identity: z.string().min(1).max(160),
  }).strict().optional(),
  classroom: z
    .object({
      projectId: z.string().max(160),
      sourceHash: z.string().max(200),
      sceneId: z.string().max(160),
      beatId: z.string().max(160).optional(),
      tick: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
});
export const learningSupplementDraftSchema = z
  .object({
    purpose: z.enum(["foundation", "clarification", "interest"]),
    kind: z.enum(["topic", "section"]),
    title: z.string().trim().min(2).max(160),
    reason: z.string().trim().min(2).max(500),
    returnGoal: z
      .string()
      .trim()
      .min(2)
      .max(500)
      .describe(
        "A learner-facing sentence describing what the learner will understand back in the original lesson. Never an ID or URL.",
      ),
    topics: z
      .array(
        z
          .string()
          .trim()
          .min(2)
          .max(160)
          .describe(
            "A short topic title, not an outline or a list of subtopics.",
          ),
      )
      .min(1)
      .max(3),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "topic" && v.topics.length !== 1)
      ctx.addIssue({
        code: "custom",
        path: ["topics"],
        message: "A topic supplement contains exactly one topic.",
      });
  });
export type LearningSupplementDraft = z.infer<
  typeof learningSupplementDraftSchema
>;
export type LearningGuidanceTurn = {
  userId: string;
  unitId: string;
  threadId?: string;
  eventId: string;
  position: import("../../../domain/src/index.js").LearningPosition;
  activeVisitId?: string;
  sourceText: string;
  performedAction?: boolean;
  responseOnly?: boolean;
};
