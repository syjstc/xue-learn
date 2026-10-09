import { materialMusicTreeIssues } from "../../../domain/src/material-music.js";
import { learnerFacingContentIssues } from "../../../domain/src/learner-facing-content.js";
import { resolveMusicCue } from "../../../domain/src/material-music-teaching.js";
import { musicCueActionSchema } from "./music-schema.js";
import { materialTeachingTreeIssues } from "../../../domain/src/material-teaching-validation.js";
import { getActivePresentationCapabilities, presentationDisplayIssues } from "./display-capabilities.js";
import { generalEducationDisplayIssues } from "./general-education-display-policy.js";
import { z } from "zod";
import type { LlmMessageRecord } from "../agents/core/types.js";
import {
  collectMaterialCueObjectIds,
  materialVisualTreeIssues,
  isMaterialLayoutCueTarget,
  legacyCompareDisplay,
} from "../../../domain/src/index.js";
import {
  assignTopicDisplayIds,
  collectDisplayFigureIds,
  coerceTopicDisplay,
  defaultTopicCueFigureId,
  firstNonEmptyString,
  asRecord,
  trimId,
  uniqueCueIds,
} from "./material-coerce/index.js";
import {
  courseMaterialTopicDisplayBindingSchema,
  legacyCourseMaterialTopicDisplayBindingSchema,
  guidedImageIllustrationSchema,
  courseMaterialTopicDisplaySchemaForCapabilities,
  type CourseMaterialAuthoredBlock,
} from "./schemas.js";
import {
  paragraphNarrationIssues,
  splitSpokenParagraphBeats,
} from "./narrated-material-sequence.js";
import type { ValidationIssue } from "./validation-report.js";

export type TopicFlattenedJitItem =
  | { kind: "introduction"; text: string }
  | { kind: "block"; block: CourseMaterialAuthoredBlock }
  | { kind: "svg_ref"; intent: unknown };

const MAX_SECTION_TOPICS = 8;

function normalizeSectionTopicsCandidate(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;
  let introduction = record.introduction;
  if (typeof introduction === "string") {
    const text = introduction.trim();
    introduction = text ? { text } : undefined;
  }
  const topics = Array.isArray(record.topics) ? record.topics : record.topics;
  if (!Array.isArray(topics)) {
    return { ...record, introduction };
  }
  const seen = new Set<string>();
  const seenTitles = new Set<string>();
  const unique = topics.flatMap((topic) => {
    const item = asRecord(topic);
    if (!item) return [];
    const id = trimId(item.id);
    const title = firstNonEmptyString(item.title);
    if (!id || !title || seen.has(id)) return [];
    const titleKey = title.toLowerCase();
    if (seenTitles.has(titleKey)) return [];
    seen.add(id);
    seenTitles.add(titleKey);
    return [{ ...item, id, title }];
  });
  return {
    ...record,
    introduction,
    topics: unique.slice(0, MAX_SECTION_TOPICS),
  };
}

export const sectionTopicsCommitBindingSchema = z.preprocess(
  normalizeSectionTopicsCandidate,
  z.object({
  introduction: z
    .object({
      text: z.string().trim().min(1),
    })
    .optional(),
  topics: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        title: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(MAX_SECTION_TOPICS)
    .superRefine((topics, ctx) => {
      const seen = new Set<string>();
      topics.forEach((topic, index) => {
        if (seen.has(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "id"],
            message: "topic ids must be unique",
          });
        }
        seen.add(topic.id);
      });
    }),
  }),
);

/** Fresh titles/openers are checked before the authoring transcript is committed. */
export const sectionTopicsAuthoringSchema = sectionTopicsCommitBindingSchema.superRefine((outline, ctx) => {
  for (const issue of learnerFacingContentIssues(outline, { internalIds: outline.topics.map(topic => topic.id) }))
    ctx.addIssue({ code: "custom", ...issue });
});

export type SectionTopicsCommit = z.infer<typeof sectionTopicsCommitBindingSchema>;

const topicCueBeatBindingSchema = z.object({
  music: musicCueActionSchema.optional(),
  text: z.string().trim().min(1),
  figureId: z.string().trim().min(1).optional(),
  targetIds: z.array(z.string().trim().min(1)).min(1).max(16).optional(),
  target: z.string().trim().min(1).optional(),
  op: z.enum(["highlight", "window"]).optional(),
  regionIds: z.array(z.string().trim().min(1)).optional(),
});

export type TopicCueBeat = z.infer<typeof topicCueBeatBindingSchema>;

export { assignTopicDisplayIds, defaultTopicCueFigureId };

function displayBodyNonEmpty(display: unknown): boolean {
  const record = asRecord(display);
  if (!record) return false;
  if (record.type === "code") {
    return (
      (typeof record.code === "string" && record.code.trim().length > 0) ||
      (Array.isArray(record.parts) && record.parts.length > 0)
    );
  }
  if (record.type === "svg_slot") {
    return Boolean(firstNonEmptyString(record.intent, asRecord(record.intent)?.setup));
  }
  if (record.type === "illustration") {
    return Boolean(
      firstNonEmptyString(record.prompt, record.caption, record.intent),
    );
  }
  if (record.type === "compare" || record.type === "stage") return true;
  return Boolean(
    firstNonEmptyString(
      record.body,
      record.text,
      record.caption,
      record.prompt,
      record.title,
    ),
  );
}

export function topicSemanticIssues(value: {
  display: unknown;
  cues: Array<{ targetIds?: string[] }>;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [...materialVisualTreeIssues(value.display), ...materialMusicTreeIssues(value.display), ...materialTeachingTreeIssues(value.display, value.cues)].map((message) => ({ code: "invalid_visual", path: "display", message }));
  const figureIds = collectDisplayFigureIds(value.display);
  const objectIds = new Set(
    collectMaterialCueObjectIds(
      value.display as Parameters<typeof collectMaterialCueObjectIds>[0],
    ),
  );
  if (!displayBodyNonEmpty(value.display)) {
    issues.push({
      code: "empty_display",
      path: "display",
      message: "display body is empty",
      fix: "Give the board real teaching content (code, prompt, body, or compare points).",
    });
  }
  const referenced = new Set<string>();
  let unknownHits = 0;
  let totalTargets = 0;
  for (const cue of value.cues) {
    for (const id of cue.targetIds ?? []) {
      totalTargets += 1;
      if (objectIds.has(id) || figureIds.has(id) || id === "whole") {
        referenced.add(id);
      } else {
        unknownHits += 1;
      }
    }
  }
  if (totalTargets > 0 && unknownHits / totalTargets > 0.5) {
    issues.push({
      code: "unknown_target_majority",
      path: "cues.*.targetIds",
      message: "more than half of cue targetIds do not exist on the board",
      expected: [...objectIds].join(", "),
    });
  }
  const display = asRecord(value.display);
  if ((value.cues.some((cue) => cue.targetIds?.some((id) => /:detail-\d+$/.test(id))) || (display?.type === "visual" || display?.type === "music" || display?.type === "teaching") || (display?.type === "stage" && (display.presentation || (Array.isArray(display.figures) && display.figures.some((figure: { type?: string }) => (figure.type === "visual" || figure.type === "music" || figure.type === "teaching")))))) && unknownHits > 0) {
    issues.push({ code: "unknown_presentation_target", path: "cues.*.targetIds",
      message: `Presentation cues must reference existing figure/part ids: ${[...objectIds].join(", ")}` });
  }

  if (display?.type === "compare") {
    const leftId = trimId(asRecord(display.left)?.id) || "left";
    const rightId = trimId(asRecord(display.right)?.id) || "right";
    const hitsLeft =
      referenced.has(leftId) || referenced.has("left") || referenced.has("whole");
    const hitsRight =
      referenced.has(rightId) ||
      referenced.has("right") ||
      referenced.has("whole");
    if (!hitsLeft || !hitsRight) {
      issues.push({
        code: "compare_uncovered",
        path: "cues",
        message: "compare cues must cover each side",
        expected: `${leftId} and ${rightId}`,
      });
    }
  }
  if (display?.type === "stage" && Array.isArray(display.figures)) {
    const missing = display.figures.flatMap((figure, index) => {
      const id = trimId(asRecord(figure)?.id) || `f${index + 1}`;
      const targets = collectMaterialCueObjectIds(
        figure as Parameters<typeof collectMaterialCueObjectIds>[0],
      );
      return referenced.has(id) || targets.some((target) => referenced.has(target))
        ? []
        : [id];
    });
    if (missing.length > 0) {
      issues.push({
        code: "stage_uncovered",
        path: "cues",
        message: `stage figures need at least one cue: ${missing.join(", ")}`,
      });
    }
  }
  return issues;
}

const topicVisibleDisplaySchema = z.union([guidedImageIllustrationSchema, legacyCourseMaterialTopicDisplayBindingSchema]).superRefine(
  (block, ctx) => {
    if (block.type === "code") {
      const hasCode = typeof block.code === "string" && block.code.length > 0;
      const hasParts = Array.isArray(block.parts) && block.parts.length > 0;
      if (!hasCode && !hasParts) {
        ctx.addIssue({
          code: "custom",
          message: "code display needs parts or code",
        });
      }
    }
  });

const topicMaterialObjectSchema = z.object({
  topicId: z.string().trim().min(1),
  display: topicVisibleDisplaySchema,
  cues: z.array(topicCueBeatBindingSchema).min(1),
});

/** Provider tool schema: visible displays only so DeepSeek strict FC can compile. */
export const topicMaterialCommitProviderBindingSchema = z.object({
  topicId: z.string().trim().min(1),
  display: courseMaterialTopicDisplayBindingSchema,
  cues: z.array(topicCueBeatBindingSchema).min(1),
});

export function topicMaterialProviderSchemaForSurface() {
  return topicMaterialCommitProviderBindingSchema.extend({ display: courseMaterialTopicDisplaySchemaForCapabilities(getActivePresentationCapabilities()) });
}

function refineTopicMaterial(
  value: z.infer<typeof topicMaterialObjectSchema>,
  ctx: z.RefinementCtx,
) {
  const figureIds = collectDisplayFigureIds(value.display);
  const objectIds = collectMaterialCueObjectIds(
    value.display as Parameters<typeof collectMaterialCueObjectIds>[0],
  );
  const objectIdList = objectIds.join(", ");
  value.cues.forEach((cue, index) => {
    try { resolveMusicCue(value.display, cue.music); } catch (error) {
      ctx.addIssue({ code: "custom", path: ["cues", index, "music"], message: error instanceof Error ? error.message : "Invalid music action" });
    }
    if (cue.figureId && !figureIds.has(cue.figureId)) {
      ctx.addIssue({
        code: "custom",
        path: ["cues", index, "figureId"],
        message: `figureId must match the display id or a stage figure id (${[...figureIds].join(", ")})`,
      });
    }
    const targetIds = cue.targetIds ?? [];
    if (targetIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["cues", index, "targetIds"],
        message: `targetIds must be one or more of: ${objectIdList}`,
      });
    }
    for (const issue of paragraphNarrationIssues(cue.text, index)) {
      ctx.addIssue({
        code: "custom",
        path: ["cues", index, "text"],
        message: issue.message,
      });
    }
  });
  for (const issue of topicSemanticIssues(value)) {
    ctx.addIssue({
      code: "custom",
      path: issue.path.split("."),
      message: issue.message,
    });
  }
}

function splitTopicCues(cues: unknown[], display: unknown): unknown[] {
  const figureIds = collectDisplayFigureIds(display);
  const objectIds = new Set(
    collectMaterialCueObjectIds(
      display as Parameters<typeof collectMaterialCueObjectIds>[0],
    ),
  );
  const defaultFigureId = defaultTopicCueFigureId(display);
  const expanded: unknown[] = [];
  for (const cue of cues) {
    const item = asRecord(cue) ?? {};
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    let figureId = trimId(item.figureId);
    if (!figureId || !figureIds.has(figureId)) figureId = defaultFigureId;
    const rawTarget = trimId(item.target);
    let targetIds = uniqueCueIds(item.targetIds);
    if (targetIds.length === 0) targetIds = uniqueCueIds(item.regionIds);
    if (targetIds.length === 0) {
      targetIds =
        rawTarget && rawTarget !== "whole" ? [rawTarget] : [figureId];
    }
    const knownTargetIds = targetIds.filter(
      (id) => objectIds.has(id) || figureIds.has(id) || id === "whole",
    );
    if (
      (["visual", "music", "teaching"].includes(String(asRecord(display)?.type))) ||
      (asRecord(display)?.type === "stage" && (asRecord(display)?.presentation || (asRecord(display)?.figures as { type?: string }[] | undefined)?.some((figure) => (figure.type === "visual" || figure.type === "music" || figure.type === "teaching")))) ||
      (targetIds.length > 0 &&
      knownTargetIds.length / targetIds.length <= 0.5)
    ) {
      // Presentations must not silently lose a requested animation target.
      // Legacy boards retain their majority-unknown gate.
    } else if (knownTargetIds.length === 0) {
      targetIds = [figureId];
    } else {
      targetIds = knownTargetIds;
    }
    const layoutTarget =
      (isMaterialLayoutCueTarget(rawTarget) ? rawTarget : "") ||
      (targetIds.length === 1 && isMaterialLayoutCueTarget(targetIds[0]!)
        ? targetIds[0]!
        : "") ||
      "whole";
    const beat: Record<string, unknown> = {
      ...item,
      figureId,
      target: layoutTarget,
      targetIds,
    };
    for (const key of Object.keys(beat)) {
      if (beat[key] == null) delete beat[key];
    }
    const texts = splitSpokenParagraphBeats(text);
    const spokenTexts = texts.length > 0 ? texts : [text];
    for (const [index, spoken] of spokenTexts.entries()) {
      const { music, ...visualBeat } = beat;
      expanded.push({ ...visualBeat, text: spoken, ...(music && index === spokenTexts.length - 1 ? { music } : {}) });
    }
  }
  return expanded;
}

function preprocessTopicMaterial(
  value: unknown,
  expectedTopicId?: string,
): unknown {
  const record = asRecord(value);
  if (!record) return value;
  const display = assignTopicDisplayIds(coerceTopicDisplay(record.display));
  const cues = Array.isArray(record.cues)
    ? splitTopicCues(record.cues, display)
    : record.cues;
  const topicId = firstNonEmptyString(record.topicId, expectedTopicId);
  return {
    ...record,
    ...(topicId ? { topicId } : {}),
    display,
    cues,
  };
}

export const topicMaterialCommitBindingSchema = z.preprocess(
  (value) => preprocessTopicMaterial(value),
  topicMaterialObjectSchema.superRefine(refineTopicMaterial),
);

export function createTopicMaterialCommitSchema(params: {
  allowedTopicIds: readonly string[];
  expectedTopicId: string;
  imagesEnabled?: boolean;
  generalEducation?: boolean;
  /** Opt in only for new provider candidates; accepted transcript reads stay compatible. */
  validateLearnerContent?: boolean;
}) {
  const allowed = new Set(params.allowedTopicIds);
  const capabilities = getActivePresentationCapabilities();
  const objectSchema = topicMaterialObjectSchema.extend({ display: capabilities
    ? courseMaterialTopicDisplaySchemaForCapabilities(capabilities)
    : z.union([guidedImageIllustrationSchema, courseMaterialTopicDisplayBindingSchema]) });
  return z.preprocess(
    (value) => preprocessTopicMaterial(value, params.expectedTopicId),
    objectSchema.superRefine((value, ctx) => {
      if (params.validateLearnerContent) for (const issue of learnerFacingContentIssues(value, { internalIds: params.allowedTopicIds }))
        ctx.addIssue({ code: "custom", ...issue });
      if (params.generalEducation) for (const message of generalEducationDisplayIssues(value.display)) {
        ctx.addIssue({ code: "custom", path: ["display"], message });
      }
      for (const message of presentationDisplayIssues(value.display, capabilities)) {
        ctx.addIssue({ code: "custom", path: ["display"], message });
      }
      if (params.imagesEnabled === false) {
        const figures = value.display.type === "stage"
          ? value.display.figures : [value.display];
        if (figures.some((figure) => figure.type === "illustration")) {
          ctx.addIssue({
            code: "custom", path: ["display"],
            message: "Image generation is unavailable. Replace illustration with svg_slot or another supported board; do not submit an empty picture placeholder.",
          });
        }
      }
      if (!allowed.has(value.topicId)) {
        ctx.addIssue({
          code: "custom",
          path: ["topicId"],
          message: `topicId must be one of: ${params.allowedTopicIds.join(", ")}`,
        });
      } else if (value.topicId !== params.expectedTopicId) {
        ctx.addIssue({
          code: "custom",
          path: ["topicId"],
          message: `call commit_topic_material for ${params.expectedTopicId} only`,
        });
      }
      refineTopicMaterial(value, ctx);
    }),
  );
}

export type TopicMaterialCommit = z.infer<typeof topicMaterialObjectSchema> & {
  needsRegenerate?: boolean;
};

export function flattenTopicToJitItems(
  topic: { id?: string; title: string },
  material: TopicMaterialCommit,
): TopicFlattenedJitItem[] {
  // Accepted pre-retirement transcripts remain immutable. Project their old
  // displays only at assembly, so resume uses the same current generation gate.
  if (material.display.type === "compare") {
    const legacy = legacyCompareDisplay(material.display);
    material = {
      ...material,
      display: courseMaterialTopicDisplayBindingSchema.parse(legacy.display),
      cues: material.cues.map((cue) => ({
        ...cue,
        figureId: material.display.id,
        target: "whole",
        targetIds: legacy.objectIds(cue.targetIds ?? [cue.target ?? "whole"]),
      })),
    };
  } else if (material.display.type === "stage") {
    const retired = material.display.figures.filter((figure) => figure.type === "compare");
    if (retired.length) {
      const figures = material.display.figures.map((figure) => {
        if (figure.type !== "compare") return figure;
        const legacy = legacyCompareDisplay(figure);
        return {
          type: "callout" as const, id: figure.id, variant: "definition" as const,
          body: legacy.display.figures.map((side) =>
            side.type === "callout" ? [side.title, side.body].filter(Boolean).join("\n\n") : "",
          ).join("\n\n"),
        };
      });
      material = {
        ...material,
        display: courseMaterialTopicDisplayBindingSchema.parse({ ...material.display, figures }),
        cues: material.cues.map((cue) => ({
          ...cue,
          ...(retired.some((figure) => figure.id === cue.figureId) ? { target: "whole" } : {}),
          targetIds: [...new Set((cue.targetIds ?? [cue.target ?? "whole"]).map((id) =>
            retired.find((figure) => legacyCompareDisplay(figure).targets([id]).length)?.id ?? id,
          ))],
        })),
      };
    }
  }
  const displayItem: TopicFlattenedJitItem =
    material.display.type === "svg_slot"
      ? { kind: "svg_ref", intent: material.display.intent }
      : { kind: "block", block: material.display };
  const topicId = trimId(topic.id) || trimId(material.topicId);
  const items: TopicFlattenedJitItem[] = [
    {
      kind: "block",
      block: {
        type: "heading",
        level: 2,
        text: topic.title,
        ...(topicId ? { topicId } : {}),
      },
    },
  ];
  if (material.needsRegenerate) {
    items.push({
      kind: "block",
      block: {
        type: "callout",
        variant: "tip",
        body: "此主题使用了服务器兜底板书，可重新生成本主题替换。",
      },
    });
  }
  items.push(displayItem);
  items.push(
    ...material.cues.map((cue) => ({
      kind: "block" as const,
      block: {
        type: "paragraph" as const,
        text: cue.text,
        cue: {
          ...(cue.music ? { music: cue.music } : {}),
          target:
            cue.target && isMaterialLayoutCueTarget(cue.target)
              ? cue.target
              : "whole",
          ...(cue.targetIds?.length ? { targetIds: cue.targetIds } : {}),
          ...(cue.figureId ? { figureId: cue.figureId } : {}),
          ...(cue.op ? { op: cue.op } : {}),
          ...(cue.regionIds?.length ? { regionIds: cue.regionIds } : {}),
        },
      },
    })),
  );
  return items;
}

export function flattenSectionTopicsToJitItems(
  outline: SectionTopicsCommit,
  materials: ReadonlyMap<string, TopicMaterialCommit>,
): TopicFlattenedJitItem[] {
  const items: TopicFlattenedJitItem[] = [];
  if (outline.introduction?.text.trim()) {
    items.push({
      kind: "introduction",
      text: outline.introduction.text.trim(),
    });
  }
  for (const topic of outline.topics) {
    const material = materials.get(topic.id);
    if (!material) continue;
    items.push(...flattenTopicToJitItems(topic, material));
  }
  return items;
}

export function acceptedSectionTopicsCommit(
  transcript: readonly LlmMessageRecord[],
): SectionTopicsCommit | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const message = transcript[index];
    if (message?.role !== "assistant") continue;
    const call = message.toolCalls?.find(
      (candidate) => candidate.name === "commit_section_topics",
    );
    if (!call) continue;
    const parsed = sectionTopicsCommitBindingSchema.safeParse(call.args);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

export function acceptedTopicMaterials(
  transcript: readonly LlmMessageRecord[],
  allowedTopicIds: readonly string[],
): Map<string, TopicMaterialCommit> {
  const allowed = new Set(allowedTopicIds);
  const found = new Map<string, TopicMaterialCommit>();
  for (const message of transcript) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) {
      if (call.name !== "commit_topic_material") continue;
      const parsed = topicMaterialCommitBindingSchema.safeParse(call.args);
      if (!parsed.success) continue;
      if (!allowed.has(parsed.data.topicId)) continue;
      found.set(parsed.data.topicId, parsed.data);
    }
  }
  return found;
}

export function resolveRewriteTopicId(
  outline: SectionTopicsCommit,
  input: { topicId?: string; topicIndex?: number },
): string | null {
  const topicId = trimId(input.topicId);
  if (topicId && outline.topics.some((topic) => topic.id === topicId)) {
    return topicId;
  }
  if (
    typeof input.topicIndex === "number" &&
    Number.isInteger(input.topicIndex) &&
    input.topicIndex >= 0 &&
    input.topicIndex < outline.topics.length
  ) {
    return outline.topics[input.topicIndex]!.id;
  }
  return null;
}

export function topicMaterialRoundUserPrompt(
  transcript: readonly LlmMessageRecord[],
  topicId: string,
): string | null {
  const expected = trimId(topicId);
  if (!expected) return null;
  for (let index = 0; index < transcript.length; index += 1) {
    const message = transcript[index];
    if (message?.role !== "assistant") continue;
    const matching = (message.toolCalls ?? []).some(
      (call) =>
        call.name === "commit_topic_material" &&
        trimId(asRecord(call.args)?.topicId) === expected,
    );
    if (!matching) continue;
    const previous = transcript[index - 1];
    const content = previous?.role === "user" ? previous.content.trim() : "";
    if (content) return previous.content;
  }
  return null;
}

export function omitTopicMaterialCommits(
  transcript: readonly LlmMessageRecord[],
  topicId: string,
): LlmMessageRecord[] {
  const expected = trimId(topicId);
  if (!expected) return [...transcript];
  const dropCallIds = new Set<string>();
  const dropIndexes = new Set<number>();
  for (let index = 0; index < transcript.length; index += 1) {
    const message = transcript[index];
    if (message?.role !== "assistant") continue;
    const matching = (message.toolCalls ?? []).filter((call) => {
      if (call.name !== "commit_topic_material") return false;
      return trimId(asRecord(call.args)?.topicId) === expected;
    });
    if (matching.length === 0) continue;
    dropIndexes.add(index);
    if (index > 0 && transcript[index - 1]?.role === "user") {
      dropIndexes.add(index - 1);
    }
    for (const call of matching) {
      if (call.id) dropCallIds.add(call.id);
    }
  }
  return transcript.filter((message, index) => {
    if (dropIndexes.has(index)) return false;
    if (
      message.role === "tool" &&
      message.toolCallId &&
      dropCallIds.has(message.toolCallId)
    ) {
      return false;
    }
    return true;
  });
}

export function transcriptHasCompletedTopicMaterial(
  transcript: readonly LlmMessageRecord[],
): boolean {
  const hasLegacy = transcript.some(
    (message) =>
      message.role === "assistant" &&
      Boolean(
        message.toolCalls?.some((call) => call.name === "commit_section_material"),
      ),
  );
  if (hasLegacy) return true;
  const outline = acceptedSectionTopicsCommit(transcript);
  if (!outline) return false;
  const materials = acceptedTopicMaterials(
    transcript,
    outline.topics.map((topic) => topic.id),
  );
  return outline.topics.every((topic) => materials.has(topic.id));
}

export function fallbackTopicMaterial(input: {
  topicId: string;
  title: string;
}): TopicMaterialCommit {
  return {
    topicId: input.topicId,
    display: {
      type: "callout",
      id: "display",
      variant: "tip",
      body: input.title,
    },
    cues: [
      {
        text: input.title,
        figureId: "display",
        target: "whole",
        targetIds: ["display"],
      },
    ],
    needsRegenerate: true,
  } as TopicMaterialCommit & { needsRegenerate: true };
}

export function withBlockFigureId<T extends object>(
  block: T,
  raw: Record<string, unknown>,
): T {
  const id = trimId(raw.id);
  return id ? ({ ...block, id } as T) : block;
}
