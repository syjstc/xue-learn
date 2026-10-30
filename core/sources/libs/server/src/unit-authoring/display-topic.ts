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
import {toJsonSchema} from "@langchain/core/utils/json_schema";
import {normalizeMinimaxToolValue} from "../providers/llm/vendors/minimax/tool-arguments.js";

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
  const schema = z.union([displayBuildTopicSchema, base]).superRefine((value, ctx) => {
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
  return z.preprocess((value, ctx) => {
    const display = (value as {display?: {type?: string}} | null)?.display;
    if (display?.type === "display") {
      const parsed = materialDisplayBlockSchema.safeParse(display);
      if (!parsed.success) {
        // Keep the precise document paths outside the display/build union;
        // otherwise the repair prompt sees only a top-level "Invalid input".
        for (const issue of parsed.error.issues) ctx.addIssue({...issue, path: ["display", ...issue.path]});
        return z.NEVER;
      }
    }
    return value;
  }, schema);
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
  const schema = base.extend({display, cues: z.array(topicMaterialCommitProviderBindingSchema.shape.cues.element)});
  const binding = toJsonSchema(schema);
  return {name: "commit_topic_material" as const,
    description: "Commit one topic using installed display plugins and their exact schemas. Complex displays use display_build with empty cues; the host persists a background component task without blocking the next topic. Other displays retain complete narration.",
    schema,
    normalizeMinimaxArgs: (args: Record<string, unknown>): Record<string, unknown> => {
      const normalized = normalizeMinimaxToolValue(args, binding) as Record<string, unknown>;
      const block = normalized.display as {type?: string; document?: import("../../../display/src/types.js").DisplayDocument} | undefined;
      if (block?.type !== "display" || !block.document || !Array.isArray(block.document.plugins)) return normalized;
      const locked = manifests.filter(manifest => block.document!.plugins.some(lock => lock?.id === manifest.id && lock.version === manifest.version));
      const visit = (node: unknown, depth: number): unknown => {
        if (!node || typeof node !== "object" || Array.isArray(node) || depth > 64) return node;
        const value = node as Record<string, unknown>;
        const matches = locked.flatMap(manifest => manifest.components.filter(component => component.kind === value.kind && component.version === value.version));
        return {...value,
          ...(Object.hasOwn(value, "payload") && matches.length === 1 && matches[0]!.payloadSchema !== undefined ? {payload: normalizeMinimaxToolValue(value.payload, matches[0]!.payloadSchema)} : {}),
          ...(Array.isArray(value.children) ? {children: value.children.map(child => visit(child, depth + 1))} : {}),
          ...(value.slots && typeof value.slots === "object" && !Array.isArray(value.slots) ? {slots: Object.fromEntries(Object.entries(value.slots).map(([name, children]) =>
            [name, Array.isArray(children) ? children.map(child => visit(child, depth + 1)) : children]))} : {}),
        };
      };
      return {...normalized, display: {...block, document: {...block.document, root: visit(block.document.root, 0)}}};
    }};
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
