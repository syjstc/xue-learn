import { z } from "zod";
import { learnerFacingContentIssues } from "../../../domain/src/learner-facing-content.js";
import type { LlmMessageRecord } from "../agents/core/types.js";
import { guidedImageIntentSchema } from "../learning-systems/capabilities/material-components/guided-image/schema.js";
import { generateCourseGuidedImage } from "./guided-image-course.js";
import { topicMaterialCommitProviderBindingSchema, createTopicMaterialCommitSchema, type TopicMaterialCommit } from "../llm/material-topic.js";

const intentDisplay = z.object({
  type: z.literal("guided_image_intent"),
  id: z.string().trim().min(1),
  intent: guidedImageIntentSchema,
});
const cue = topicMaterialCommitProviderBindingSchema.shape.cues.element;
export const guidedImageTopicDraftSchema = z.object({
  topicId: z.string().trim().min(1), display: intentDisplay,
  cues: z.array(cue).length(0).describe("Always empty: narration is generated only after the image and its regions exist."),
});
export type GuidedImageTopicDraft = z.infer<typeof guidedImageTopicDraftSchema>;

export const guidedImageTopicTool = {
  name: "commit_topic_material" as const,
  description: "Commit this topic. Native music, visual, text and code displays keep ordinary cues. Use music when listening or notation is teaching evidence. Other pictures use guided_image_intent and an empty cues array; the child generates the image, locates regions, then writes grounded narration.",
  schema: topicMaterialCommitProviderBindingSchema.extend({
    // Keep each provider union branch an object, including native visual kinds.
    // DeepSeek strict tools reject a nested union branch without an object type.
    display: z.union([intentDisplay, ...topicMaterialCommitProviderBindingSchema.shape.display.options]),
    cues: z.array(cue),
  }),
};

export function createGuidedImageTopicSchema(params: Parameters<typeof createTopicMaterialCommitSchema>[0]) {
  return z.union([guidedImageTopicDraftSchema, createTopicMaterialCommitSchema(params)]).superRefine((value, ctx) => {
    if (value.topicId !== params.expectedTopicId)
      ctx.addIssue({ code: "custom", message: `Commit only topic ${params.expectedTopicId}` });
    if (value.display.type === "guided_image_intent") {
      if (params.validateLearnerContent) for (const issue of learnerFacingContentIssues(value, { internalIds: params.allowedTopicIds }))
        ctx.addIssue({ code: "custom", ...issue });
      return;
    }
    const figures = value.display.type === "stage" ? value.display.figures : [value.display];
    if (figures.some((figure) => ["illustration", "svg_slot"].includes(figure.type)))
      ctx.addIssue({ code: "custom", message: "For this teacher, submit the entire picture as guided_image_intent with cues: []; do not write picture narration before the image exists." });
  });
}

export function acceptedGuidedImageDrafts(transcript: readonly LlmMessageRecord[], allowedIds: readonly string[]) {
  const found = new Map<string, { draft: GuidedImageTopicDraft; revisionId: string }>();
  for (const message of transcript) for (const call of message.role === "assistant" ? message.toolCalls ?? [] : []) {
    if (call.name !== "commit_topic_material") continue;
    const parsed = guidedImageTopicDraftSchema.safeParse(call.args);
    if (parsed.success && allowedIds.includes(parsed.data.topicId))
      found.set(parsed.data.topicId, { draft: parsed.data, revisionId: call.id });
    else if (typeof call.args === "object" && call.args !== null && "topicId" in call.args)
      found.delete(String(call.args.topicId));
  }
  return found;
}

export async function completeGuidedImageTopic(input: Omit<Parameters<typeof generateCourseGuidedImage>[0], "intent"> & { draft: GuidedImageTopicDraft }): Promise<TopicMaterialCommit> {
  const guidedImage = await generateCourseGuidedImage({ ...input, intent: input.draft.display.intent });
  const id = input.draft.display.id;
  return {
    topicId: input.draft.topicId,
    display: {
      type: "illustration", id, caption: guidedImage.intent.title,
      prompt: guidedImage.intent.composition, style: "concept", aspectRatio: "4:3",
      imageId: `ill-guided-${guidedImage.image.sha256}`, imageUrl: guidedImage.image.src, guidedImage,
    },
    cues: guidedImage.beats.map((beat) => ({
      text: beat.text, figureId: id, target: "whole", op: "highlight",
      targetIds: beat.regionIds.length ? [...beat.regionIds] : [id], regionIds: [...beat.regionIds],
    })),
  };
}
