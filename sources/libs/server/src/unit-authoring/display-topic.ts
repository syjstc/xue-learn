import {learnerFacingContentIssues} from "../../../domain/src/learner-facing-content.js";
import { z } from "zod";
import { displayBuildIntentSchema, materialDisplayBlockSchema, type DisplayBuildIntent } from "../../../domain/src/material-display.js";
import type { DisplayPluginManifest } from "../../../display/src/types.js";
import { validateDisplayPayload } from "../../../display/src/validation.js";
import type { LlmMessageRecord } from "../agents/core/types.js";
import { authoredDisplayDocumentIssues } from "../display-build/catalog.js";
import { enqueueDisplayMaterial } from "../display-build/material.js";
import { getDisplayBuildRuntime } from "../display-build/service.js";
import { topicMaterialCommitProviderBindingSchema, type TopicMaterialCommit } from "../llm/material-topic.js";
import { guidedImageTopicTool } from "./guided-image-topic.js";

export const displayBuildTopicSchema = z.object({
  topicId: z.string().trim().min(1), display: displayBuildIntentSchema,
  cues: z.array(z.unknown()).length(0).describe("Empty: the component agent owns its complete narration."),
});
export type DisplayBuildTopicDraft = z.infer<typeof displayBuildTopicSchema>;

function buildIssues(intent: DisplayBuildIntent, manifests: readonly DisplayPluginManifest[]): string[] {
  const manifest = manifests.find(item => item.id === intent.pluginId && item.version === intent.pluginVersion);
  const builder = manifest?.builders?.find(item => item.id === intent.builderId);
  if (!builder || !getDisplayBuildRuntime()?.hasBuilder(builder.outputKind, builder.outputVersion))
    return [`No installed builder ${intent.pluginId}@${intent.pluginVersion}/${intent.builderId}`];
  return [...validateDisplayPayload(intent.input, builder.inputSchema), ...learnerFacingContentIssues({title: intent.title}).map(issue => issue.message)];
}

export function createDisplayTopicSchema<T>(base: z.ZodType<T>, manifests: readonly DisplayPluginManifest[], expectedTopicId: string) {
  return z.union([displayBuildTopicSchema, base]).superRefine((value, ctx) => {
    const candidate = value as {topicId?: string; display?: Record<string, unknown>};
    if (candidate.topicId !== expectedTopicId) ctx.addIssue({code: "custom", message: `Commit only topic ${expectedTopicId}`});
    if (manifests.length && candidate.display && !["display", "display_build", "guided_image_intent"].includes(String(candidate.display.type)))
      ctx.addIssue({code: "custom", path: ["display"], message: "New topics must use an installed plugin display document or builder"});
    if (candidate.display?.type === "display_build") {
      for (const message of buildIssues(candidate.display as DisplayBuildIntent, manifests)) ctx.addIssue({code: "custom", path: ["display"], message});
    } else if (candidate.display?.type === "display") {
      for (const message of authoredDisplayDocumentIssues(candidate.display.document as import("../../../display/src/types.js").DisplayDocument, manifests))
        ctx.addIssue({code: "custom", path: ["display", "document"], message});
    }
  });
}

export function createDisplayTopicTool(manifests: readonly DisplayPluginManifest[], imageFirst: boolean) {
  const base = imageFirst ? guidedImageTopicTool.schema : topicMaterialCommitProviderBindingSchema;
  const builds = manifests.flatMap(manifest => (manifest.builders ?? []).flatMap(builder => {
    if (!getDisplayBuildRuntime()?.hasBuilder(builder.outputKind, builder.outputVersion)) return [];
    return [displayBuildIntentSchema.extend({pluginId: z.literal(manifest.id), pluginVersion: z.literal(manifest.version), builderId: z.literal(builder.id),
      input: builder.inputSchema === undefined ? z.record(z.string(), z.unknown()) : z.fromJSONSchema(builder.inputSchema as Parameters<typeof z.fromJSONSchema>[0])})];
  }));
  const displays: z.ZodType[] = manifests.length ? [materialDisplayBlockSchema,
    ...(imageFirst ? [guidedImageTopicTool.schema.shape.display.options[0]!] : []), ...builds] : [...base.shape.display.options, ...builds];
  const display = displays.length === 1 ? displays[0]! : z.union(displays as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  return {name: "commit_topic_material" as const,
    description: "Commit one topic using installed display plugins and their exact schemas. Complex displays use display_build with empty cues; the host persists a background component task without blocking the next topic. Other displays retain complete narration.",
    schema: base.extend({display, cues: z.array(topicMaterialCommitProviderBindingSchema.shape.cues.element)})};
}

export function acceptedDisplayBuildDrafts(messages: readonly LlmMessageRecord[], allowed: readonly string[]) {
  const drafts = new Map<string, {draft: DisplayBuildTopicDraft; revisionId: string}>();
  for (const message of messages) for (const call of message.role === "assistant" ? message.toolCalls ?? [] : []) {
    if (call.name !== "commit_topic_material") continue;
    const parsed = displayBuildTopicSchema.safeParse(call.args);
    if (parsed.success && allowed.includes(parsed.data.topicId)) drafts.set(parsed.data.topicId, {draft: parsed.data, revisionId: call.id});
    else if (call.args && typeof call.args === "object" && "topicId" in call.args) drafts.delete(String(call.args.topicId));
  }
  return drafts;
}

export async function enqueueDisplayTopic(input: {
  userId: string; unitId: string; sectionId: string; prompt: string; revisionId: string;
  draft: DisplayBuildTopicDraft; manifests: readonly DisplayPluginManifest[];
}): Promise<TopicMaterialCommit> {
  const issues = buildIssues(input.draft.display, input.manifests);
  if (issues.length) throw Error(issues.join("; "));
  const display = await enqueueDisplayMaterial({ownerUserId: input.userId, unitId: input.unitId, sectionId: input.sectionId,
    revisionId: input.revisionId, intent: input.draft.display, manifests: input.manifests, sourceContext: input.prompt});
  return {topicId: input.draft.topicId, display, cues: []};
}
