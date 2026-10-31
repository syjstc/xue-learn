import { guidedImageIllustrationSchema } from "./schemas.js";
import { learnerFacingContentIssues } from "../../../domain/src/learner-facing-content.js";
import { resolveCodeBoardSource } from "../../../domain/src/index.js";
import { z } from "zod";
import {
  coerceAuthoredHeadingLevel,
  coerceCompareSide,
} from "./material-coerce/index.js";
import type { MaterialGenerationPolicy } from "./component-dsl-registry.js";
import { courseSvgAuthoringIntentSchema } from "./course-svg-intent.js";
import { rewriteInLessonVisualWireItemToIllustration } from "./illustration-from-visual-intent.js";
import {
  dedupeExactMaterialBlocks,
  MAX_KEY_TAKEAWAYS,
  MIN_LEARNING_MATERIAL_BLOCKS,
} from "./normalize-learning-material.js";
import {
  cornellSchema,
  courseMaterialAuthoredBlockBindingSchema,
  decomposeResultSchema,
  decomposeUnitBindingSchema,
  decomposeUnitSchema,
  generatableComplexInteractiveBlockTypeSchema,
  interactiveBlockSchema,
  MAX_GENERATED_LEARNING_MATERIAL_BLOCKS,
  MAX_GENERATED_LEARNING_MATERIAL_ITEMS,
  microTopicScopeSchema,
  microUnitResultSchema,
  quizQuestionSchema,
  flashCardDraftSchema,
  subdivideResultSchema,
  subdivideUnitSchema,
  unitLearningTargetSchema,
  type DecomposeResult,
  type InteractiveBlock,
  type LearningMaterialContent,
  type MicroUnitResult,
  type QuizQuestion,
  type FlashCardDraft,
  type SqPreview,
  type SubdivideResult,
} from "./schemas.js";
import { normalizeStreamQuizQuestion } from "./normalize-quiz.js";
import type {
  InvalidItemRepair,
  MissingItemRepair,
} from "./validated-structured-generation.js";
import { stripInternalLearningTargetRefs } from "./learner-facing-text.js";
import { parseEncodedLlmJson } from "./sanitize-response.js";
import { expandLearningMaterialCompact } from "./compact-json.js";
import { containsCollapsedGeneratedCodeFence } from "../markdown/validate-code-fences.js";
import {
  addNarratedMaterialSequenceIssues,
  splitSpokenParagraphBeats,
  type NarratedMaterialSequenceToken,
} from "./narrated-material-sequence.js";
import {
  surveyPreviewItemSchema,
  surveyOutlineItemSchema,
  surveyQuestionItemSchema,
  surveySectionPlanItemContractSchema,
} from "../survey/authoring.js";

/** Resolved source items persisted in session graph state and used by edits. */
export const materialJitItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("introduction"), text: z.string().min(1) }),
  z.object({ kind: z.literal("block"), block: interactiveBlockSchema }),
  z.object({ kind: z.literal("takeaway"), text: z.string().min(1) }),
]);

export type MaterialJitItem = z.infer<typeof materialJitItemSchema>;

/**
 * Provider-safe initial authoring contract. Direct executable complex/check
 * blocks are impossible here; those enter the resolved source list only after
 * their server compilers validate them.
 */
export const materialIntroductionJitItemSchema = z.object({
  kind: z.literal("introduction"),
  text: z.string().overwrite(stripInternalLearningTargetRefs).trim().min(1),
});
export const materialAuthoredBlockJitItemSchema = z.object({
  kind: z.literal("block"),
  block: courseMaterialAuthoredBlockBindingSchema.superRefine((block, ctx) => {
    if (containsCollapsedGeneratedCodeFence(block)) {
      ctx.addIssue({
        code: "custom",
        message:
          "substantial fenced source code must use physical newlines and source indentation; do not flatten it into one line",
      });
    }
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
  }),
});
export const materialTakeawayJitItemSchema = z.object({
  kind: z.literal("takeaway"),
  text: z.string().overwrite(stripInternalLearningTargetRefs).trim().min(1),
});
export const materialComponentSlotIntentSchema = z.object({
  setup: z
    .string()
    .overwrite(stripInternalLearningTargetRefs)
    .trim()
    .min(1)
    .max(1_000),
  learningGoal: z
    .string()
    .overwrite(stripInternalLearningTargetRefs)
    .trim()
    .min(1)
    .max(1_000),
  expectedInsight: z
    .string()
    .overwrite(stripInternalLearningTargetRefs)
    .trim()
    .min(1)
    .max(1_000),
});
export const materialSvgSlotIntentSchema = courseSvgAuthoringIntentSchema;
export const materialComponentRefJitItemSchema = z.object({
  kind: z.literal("component_ref"),
  componentId: z.string().regex(/^component_[1-8]$/),
  intent: materialComponentSlotIntentSchema.optional(),
});
export const materialComponentIntentJitItemSchema = z.object({
  kind: z.literal("component_intent"),
  componentType: generatableComplexInteractiveBlockTypeSchema,
  intent: materialComponentSlotIntentSchema,
});
export const materialSvgRefJitItemSchema = z.object({
  kind: z.literal("svg_ref"),
  intent: materialSvgSlotIntentSchema,
});
export const materialInlineCheckRefJitItemSchema = z.object({
  kind: z.literal("inline_check_ref"),
  slotRef: z.string().min(1),
});
export const materialGenerationJitItemBindingSchema = z.discriminatedUnion(
  "kind",
  [
    materialIntroductionJitItemSchema,
    materialAuthoredBlockJitItemSchema,
    materialTakeawayJitItemSchema,
    materialComponentRefJitItemSchema,
    materialComponentIntentJitItemSchema,
    materialSvgRefJitItemSchema,
    materialInlineCheckRefJitItemSchema,
  ],
);

const MATERIAL_GENERATION_ITEM_KINDS = new Set([
  "introduction",
  "block",
  "takeaway",
  "component_ref",
  "component_intent",
  "svg_ref",
  "inline_check_ref",
]);

function directComplexComponentIntent(
  item: Record<string, unknown>,
): Record<string, unknown> | null {
  if (
    typeof item.type !== "string" ||
    !generatableComplexInteractiveBlockTypeSchema.safeParse(item.type).success
  ) {
    return null;
  }
  const suppliedIntent = materialComponentSlotIntentSchema.safeParse(
    item.intent,
  );
  if (suppliedIntent.success) {
    return {
      kind: "component_intent",
      componentType: item.type,
      intent: suppliedIntent.data,
    };
  }

  const firstText = (...values: unknown[]) =>
    values
      .find(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      )
      ?.trim();
  const description =
    firstText(item.summary, item.caption, item.description, item.title) ||
    `Create the requested ${item.type} teaching visual.`;
  return {
    kind: "component_intent",
    componentType: item.type,
    intent: {
      setup: description,
      learningGoal: firstText(item.title) || description,
      expectedInsight: description,
    },
  };
}

/**
 * Canonical provider-native envelope for long course-material authoring.
 * MiniMax/OpenAI-compatible function tools need one object whose `items`
 * array can grow — sibling `introduction`/`blocks`/`keyTakeaways` fields
 * delay the first paint until later arrays exist. Each item is a plain
 * wire object (`type` plus that shape's fields). Cardinality and content
 * invariants remain authoritative in the server-side item/result schemas
 * after this transport shape is normalized. Legacy `{json: string}` items
 * remain readable.
 */
export const materialGenerationEnvelopeItemBindingSchema = z.record(
  z.string(),
  z.unknown(),
);

export const materialGenerationEnvelopeBindingSchema = z.object({
  items: z.array(z.unknown()),
});

function unwrapMaterialEnvelopeJson(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).json !== "string"
  ) {
    return value;
  }
  try {
    return parseEncodedLlmJson((value as { json: string }).json);
  } catch {
    // Preserve the addressable invalid item so positional recovery repairs
    // this slot only instead of regenerating the envelope.
    return value;
  }
}

function skipJsonString(text: string, start: number): number | null {
  if (text[start] !== '"') return null;
  let escape = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') return index + 1;
  }
  return null;
}

function skipBalancedJsonValue(text: string, start: number): number | null {
  const opener = text[start];
  if (opener !== "{" && opener !== "[") return null;
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      const end = skipJsonString(text, index);
      if (end == null) return null;
      index = end - 1;
      continue;
    }
    if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

function parseConcatenatedJsonValues(text: string): unknown[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  const values: unknown[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    while (cursor < trimmed.length && /\s/.test(trimmed[cursor]!)) cursor += 1;
    if (cursor >= trimmed.length) break;
    const end = skipBalancedJsonValue(trimmed, cursor);
    if (end == null) return values.length > 0 ? values : null;
    try {
      values.push(JSON.parse(trimmed.slice(cursor, end)));
    } catch {
      return values.length > 0 ? values : null;
    }
    cursor = end;
  }
  return values.length > 0 ? values : null;
}

function normalizeMaterialEnvelopeItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseEncodedLlmJson(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const items = (parsed as { items?: unknown }).items;
      if (Array.isArray(items)) return items;
    }
  } catch {
    // Fall through to concatenated-object salvage.
  }
  return parseConcatenatedJsonValues(trimmed);
}

/**
 * Convert the canonical material envelope into the internal progressive item
 * stream. Partial native candidates may omit fields while they are streaming;
 * the provider binding still validates the complete final envelope.
 *
 * A bare array is also accepted here as a narrow compatibility fallback for a
 * provider that ignores the native envelope but still returns valid items.
 * Legacy `{introduction,blocks,keyTakeaways}` objects and `{json: string}`
 * items remain readable. A MiniMax-style `items` string of concatenated
 * objects is salvaged instead of treated as an empty lesson.
 */
export function normalizeMaterialGenerationEnvelopeCandidate(
  candidate: unknown,
): unknown {
  if (Array.isArray(candidate)) {
    return { items: candidate.map(unwrapMaterialEnvelopeJson) };
  }
  if (candidate === null || typeof candidate !== "object") return candidate;
  const rawEnvelope = candidate as Record<string, unknown>;
  const envelope = (
    typeof rawEnvelope.intro === "string" ||
    Array.isArray(rawEnvelope.b) ||
    Array.isArray(rawEnvelope.kt)
      ? expandLearningMaterialCompact(rawEnvelope)
      : rawEnvelope
  ) as Record<string, unknown>;
  const normalizedItems = normalizeMaterialEnvelopeItems(envelope.items);
  if (normalizedItems) {
    return { items: normalizedItems.map(unwrapMaterialEnvelopeJson) };
  }

  const items: unknown[] = [];
  if (typeof envelope.introduction === "string") {
    items.push({ type: "introduction", text: envelope.introduction });
  }
  if (Array.isArray(envelope.blocks)) {
    items.push(...envelope.blocks.map(unwrapMaterialEnvelopeJson));
  }
  if (Array.isArray(envelope.keyTakeaways)) {
    items.push(
      ...envelope.keyTakeaways.map((text) => ({ type: "takeaway", text })),
    );
  }
  return { items };
}

function coerceMaterialItemWireDiscriminator(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const kind = item.kind;
  // visual.kind selects the renderer; it is not an accidental item wrapper.
  if (item.type === "visual" || item.type === "music" || item.type === "teaching") return item;
  if (typeof kind !== "string" || MATERIAL_GENERATION_ITEM_KINDS.has(kind)) {
    return item;
  }
  // Repair and some providers copy the public wire name onto `kind`
  // (`svg_slot`, `paragraph`, `component_slot`) even though the internal
  // contract uses `kind` only for JIT wrappers. Treat that as `type`.
  const { kind: _dropped, ...rest } = item;
  return rest.type == null ? { ...rest, type: kind } : rest;
}

/**
 * Some models encode a discriminated object as `{ [type]: payload }` instead
 * of placing the discriminator beside its fields. Recover that unambiguous
 * single-key shape before applying the normal wire-to-JIT conversions.
 *
 * SVG slots are slightly different from authored blocks: their keyed payload
 * is the semantic intent itself, so `{ svg_slot: intent }` maps to
 * `{ type: "svg_slot", intent }`.
 */
function unwrapMaterialTypeKey(
  item: Record<string, unknown>,
): Record<string, unknown> {
  if (item.type != null || item.kind != null) return item;
  const entries = Object.entries(item);
  if (entries.length !== 1) return item;
  const [[type, payload]] = entries;
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return item;
  }
  const fields = payload as Record<string, unknown>;
  if (type === "svg_slot") {
    return fields.intent != null
      ? { type, ...fields }
      : { type, intent: fields };
  }
  return { type, ...fields };
}

/**
 * Recover common prose-field aliases emitted inside the deliberately loose
 * material envelope. The canonical field always wins; this only prevents an
 * otherwise valid item from consuming a positional-repair call because a
 * provider used `text`/`content`/`body` interchangeably.
 */
function normalizeMaterialProseFieldAliases(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const firstString = (...values: unknown[]) =>
    values.find((value): value is string => typeof value === "string");

  // GLM and a few OpenAI-compatible providers sometimes flatten the callout
  // variant into the block discriminator (`type: "warning"`) even though the
  // provider prompt documents the canonical
  // `{ type: "callout", variant: "warning" }` shape. The shorthand is
  // unambiguous and still carries the same title/body fields, so normalize it
  // before the authored-block discriminated union validates the item.
  if (
    item.type === "tip" ||
    item.type === "warning" ||
    item.type === "definition" ||
    item.type === "example"
  ) {
    item = { ...item, variant: item.type, type: "callout" };
  }

  if (item.type === "heading") {
    const text = firstString(item.text, item.title, item.content);
    return {
      ...item,
      type: "heading",
      level: coerceAuthoredHeadingLevel(
        item.level ?? item.headingLevel ?? item.heading_level,
      ),
      ...(text === undefined ? {} : { text }),
    };
  }

  if (item.type === "compare") {
    return {
      ...item,
      type: "compare",
      left: coerceCompareSide(item.left ?? item.a),
      right: coerceCompareSide(item.right ?? item.b),
    };
  }

  if (item.type === "callout" || item.type === "accordion") {
    if (typeof item.body === "string") return item;
    const body = firstString(item.text, item.content);
    return body === undefined ? item : { ...item, body };
  }
  if (item.type === "paragraph" || item.type === "heading") {
    if (typeof item.text === "string") return item;
    const text = firstString(item.body, item.content);
    return text === undefined ? item : { ...item, text };
  }
  if (item.type === "code") {
    const source = resolveCodeBoardSource(
      typeof item.code === "string"
        ? item.code
        : firstString(item.text, item.content, item.body),
      item.parts,
    );
    if (!source) return item;
    const { parts: _parts, ...withoutParts } = item;
    return {
      ...withoutParts,
      code: source.code,
      ...(source.parts ? { parts: source.parts } : {}),
    };
  }
  if (item.type === "introduction" || item.type === "takeaway") {
    if (typeof item.text === "string") return item;
    const text = firstString(item.body, item.content);
    return text === undefined ? item : { ...item, text };
  }
  return item;
}

export function normalizeMaterialGenerationItem(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.json === "string" &&
    raw.kind == null &&
    raw.type == null &&
    Object.keys(raw).length === 1
  ) {
    try {
      return normalizeMaterialGenerationItem(parseEncodedLlmJson(raw.json));
    } catch {
      return value;
    }
  }
  const item = normalizeMaterialProseFieldAliases(
    coerceMaterialItemWireDiscriminator(unwrapMaterialTypeKey(raw)),
  );

  // The provider-facing material wire format is a flat root array: authored
  // blocks are direct objects, while the opener and synthesis use their own
  // `type` discriminators. Keep internal JIT wrappers server-only.
  if (
    (item.type === "introduction" || item.type === "takeaway") &&
    typeof item.text === "string"
  ) {
    return { kind: item.type, text: item.text };
  }
  // Compatibility for providers that use the generic prose label `block`
  // instead of the canonical authored-block discriminator `paragraph`.
  // Keep this narrow so historical nested `{ type: "block", block: ... }`
  // wrappers continue through the wrapper-unwrapping path below.
  if (
    item.type === "block" &&
    typeof item.text === "string" &&
    item.block == null
  ) {
    return {
      kind: "block",
      block: { type: "paragraph", text: item.text },
    };
  }
  if (
    item.type === "component_slot" &&
    typeof item.componentType === "string" &&
    item.intent !== null &&
    typeof item.intent === "object" &&
    !Array.isArray(item.intent)
  ) {
    return {
      kind: "component_intent",
      componentType: item.componentType,
      intent: item.intent,
    };
  }
  if (
    item.type === "component_slot" &&
    typeof item.slotRef === "string" &&
    item.intent !== null &&
    typeof item.intent === "object" &&
    !Array.isArray(item.intent)
  ) {
    return {
      kind: "component_ref",
      componentId: item.slotRef,
      intent: item.intent,
    };
  }
  if (
    item.type === "svg_slot" &&
    item.intent !== null &&
    typeof item.intent === "object" &&
    !Array.isArray(item.intent)
  ) {
    return { kind: "svg_ref", intent: item.intent };
  }
  if (
    typeof item.type === "string" &&
    item.type !== "block" &&
    (item.kind == null || item.type === "visual" || item.type === "music" || item.type === "teaching")
  ) {
    const componentIntent = directComplexComponentIntent(item);
    if (componentIntent) return componentIntent;
    const block =
      item.type === "callout" && item.title === null
        ? Object.fromEntries(
            Object.entries(item).filter(([key]) => key !== "title"),
          )
        : item;
    return { kind: "block", block };
  }

  const outerBlock = item.block;
  if (
    item.kind !== "block" ||
    outerBlock === null ||
    typeof outerBlock !== "object" ||
    Array.isArray(outerBlock)
  ) {
    return item;
  }
  let wrapper = normalizeMaterialProseFieldAliases(
    coerceMaterialItemWireDiscriminator(
      unwrapMaterialTypeKey(outerBlock as Record<string, unknown>),
    ),
  );
  if (
    wrapper.type === "block" &&
    wrapper.block !== null &&
    typeof wrapper.block === "object" &&
    !Array.isArray(wrapper.block)
  ) {
    wrapper = normalizeMaterialProseFieldAliases(
      wrapper.block as Record<string, unknown>,
    );
  }

  // Some providers preserve the outer `kind: "block"` envelope for every
  // record and put item-level discriminators inside `block.type`. These are
  // unambiguous wire-shape mistakes, so restore the intended item contract
  // before schema validation.
  if (
    (wrapper.type === "introduction" || wrapper.type === "takeaway") &&
    typeof wrapper.text === "string"
  ) {
    return { kind: wrapper.type, text: wrapper.text };
  }
  if (
    wrapper.type === "component_ref" &&
    typeof wrapper.componentId === "string"
  ) {
    return {
      kind: "component_ref",
      componentId: wrapper.componentId,
    };
  }
  if (
    wrapper.type === "component_slot" &&
    typeof wrapper.componentType === "string" &&
    wrapper.intent !== null &&
    typeof wrapper.intent === "object" &&
    !Array.isArray(wrapper.intent)
  ) {
    return {
      kind: "component_intent",
      componentType: wrapper.componentType,
      intent: wrapper.intent,
    };
  }
  if (
    wrapper.type === "component_slot" &&
    typeof wrapper.slotRef === "string"
  ) {
    return {
      kind: "component_ref",
      componentId: wrapper.slotRef,
      intent: wrapper.intent,
    };
  }
  if (
    wrapper.type === "svg_slot" &&
    wrapper.intent !== null &&
    typeof wrapper.intent === "object" &&
    !Array.isArray(wrapper.intent)
  ) {
    return { kind: "svg_ref", intent: wrapper.intent };
  }

  const componentIntent = directComplexComponentIntent(wrapper);
  if (componentIntent) return componentIntent;

  return { ...item, block: wrapper };
}

export function materialItemsFromProviderPayload(value: unknown): unknown[] {
  const normalized = normalizeMaterialGenerationEnvelopeCandidate(value);
  if (
    !normalized ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    return [];
  }
  const items = (normalized as { items?: unknown }).items;
  return Array.isArray(items)
    ? items.flatMap(expandMaterialGenerationItem)
    : [];
}

function expandMaterialGenerationItem(value: unknown): unknown[] {
  const item = normalizeMaterialGenerationItem(value);
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [item];
  }
  const record = item as {
    kind?: string;
    block?: { type?: string; text?: string };
  };
  if (
    record.kind === "block" &&
    record.block?.type === "paragraph" &&
    typeof record.block.text === "string"
  ) {
    const beats = splitSpokenParagraphBeats(record.block.text);
    if (beats.length > 1) {
      const cue = (record.block as { cue?: unknown }).cue;
      return beats.map((text) => ({
        kind: "block",
        block: {
          type: "paragraph",
          text,
          ...(cue ? { cue } : {}),
        },
      }));
    }
  }
  return [item];
}

/** Convert the flat provider wire format and tolerate one historical wrapper. */
export const materialGenerationJitItemSchema = z.preprocess(
  normalizeMaterialGenerationItem,
  z.union([z.object({ kind: z.literal("block"), block: guidedImageIllustrationSchema }), materialGenerationJitItemBindingSchema])
    .superRefine((item, ctx) => {
      for (const issue of learnerFacingContentIssues(item))
        ctx.addIssue({ code: "custom", ...issue });
    }),
);

export type MaterialGenerationJitItem = z.infer<
  typeof materialGenerationJitItemSchema
>;

export function createMaterialGenerationJitItemsSchema(params: {
  policy: MaterialGenerationPolicy;
  /** Block slots reserved for server-compiled inline checks. */
  reservedServerBlockCount?: number;
  /** Missing contextual slots may fall back to deterministic server placement. */
  requirePlannedComponents?: boolean;
  /** New course authoring uses the video/PPT-friendly narrated spine. */
  enforceNarratedSequence?: boolean;
}) {
  const plannedIds = new Set(
    (params.policy.plannedComponents ?? []).map((component) => component.id),
  );
  const authoredBlockLimit = Math.max(
    MIN_LEARNING_MATERIAL_BLOCKS,
    MAX_GENERATED_LEARNING_MATERIAL_BLOCKS -
      Math.max(0, Math.trunc(params.reservedServerBlockCount ?? 0)),
  );
  return z.preprocess(
    (value) => {
      if (
        !Array.isArray(value) ||
        !params.policy.replaceInLessonVisualsWithIllustrations
      ) {
        return value;
      }
      return value.map(rewriteInLessonVisualWireItemToIllustration);
    },
    z
      .array(materialGenerationJitItemSchema)
      .min(1)
      .max(MAX_GENERATED_LEARNING_MATERIAL_ITEMS)
      .superRefine((items, ctx) => {
      const introductions = items.flatMap((item, index) =>
        item.kind === "introduction" ? [index] : [],
      );
      // Introduction is an optional typed opener in the flat items array — same
      // content unit as a block. Missing intro must not fail closed when blocks
      // already render a complete lesson.
      if (introductions.length > 1) {
        ctx.addIssue({
          code: "custom",
          message: "material allows at most one introduction item",
        });
      }

      const refs = items.flatMap((item, index) =>
        item.kind === "component_ref" ? [{ item, index }] : [],
      );
      const intents = items.flatMap((item, index) =>
        item.kind === "component_intent" ? [{ item, index }] : [],
      );
      if (plannedIds.size > 0 && intents.length > 0) {
        ctx.addIssue({
          code: "custom",
          message:
            "legacy frozen component plans cannot be mixed with material-owned component intents",
        });
      }
      if (refs.length + intents.length > params.policy.maxComponentCount) {
        ctx.addIssue({
          code: "custom",
          message: `material allows at most ${params.policy.maxComponentCount} interactive component intent(s)`,
        });
      }
      const allowedTypes = new Set(params.policy.allowedComponentTypes);
      for (const { item, index } of intents) {
        if (!allowedTypes.has(item.componentType)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "componentType"],
            message: `componentType ${item.componentType} is outside the selected category palette`,
          });
        }
      }
      const seenRefs = new Set<string>();
      for (const { item, index } of refs) {
        if (!plannedIds.has(item.componentId)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "componentId"],
            message: `componentId ${item.componentId} is not in the frozen component plan`,
          });
        }
        if (seenRefs.has(item.componentId)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "componentId"],
            message: `componentId ${item.componentId} must appear exactly once`,
          });
        }
        seenRefs.add(item.componentId);
      }
      if (params.requirePlannedComponents !== false) {
        for (const componentId of plannedIds) {
          if (!seenRefs.has(componentId)) {
            ctx.addIssue({
              code: "custom",
              message: `planned componentId ${componentId} must appear exactly once`,
            });
          }
        }
      }
      const illustrations = items.flatMap((item, index) =>
        item.kind === "block" && item.block.type === "illustration"
          ? [index]
          : [],
      );
      // Keep authored illustration blocks even when 配图 is off or a raster
      // later fails — the lesson still publishes and images can regenerate.
      if (
        params.policy.allowIllustrations &&
        illustrations.length < (params.policy.minIllustrationCount ?? 0)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `material requires at least ${params.policy.minIllustrationCount} illustration block(s) per course section`,
        });
      }

      const blockEquivalentCount = items.filter(
        (item) =>
          item.kind === "introduction" ||
          item.kind === "block" ||
          item.kind === "component_ref" ||
          item.kind === "component_intent" ||
          item.kind === "svg_ref",
      ).length;
      if (blockEquivalentCount < MIN_LEARNING_MATERIAL_BLOCKS && !items.some(item => item.kind === "block" && item.block.type === "display")) {
        ctx.addIssue({
          code: "custom",
          message: `material requires at least ${MIN_LEARNING_MATERIAL_BLOCKS} content items (introduction, blocks, or visual slots)`,
        });
      }
      // Authored block budget excludes the optional introduction opener.
      const authoredBlockCount = items.filter(
        (item) =>
          item.kind === "block" ||
          item.kind === "component_ref" ||
          item.kind === "component_intent" ||
          item.kind === "svg_ref",
      ).length;
      if (authoredBlockCount > authoredBlockLimit) {
        ctx.addIssue({
          code: "custom",
          message: `material allows at most ${authoredBlockLimit} authored block-producing items after reserving server blocks`,
        });
      }

      const takeawayCount = items.filter(
        (item) => item.kind === "takeaway",
      ).length;
      if (takeawayCount > MAX_KEY_TAKEAWAYS) {
        ctx.addIssue({
          code: "custom",
          message: `material allows at most ${MAX_KEY_TAKEAWAYS} takeaway items`,
        });
      }
      if (params.enforceNarratedSequence) {
        const narratedTokens = items.reduce<NarratedMaterialSequenceToken[]>(
          (tokens, item, sourceIndex) => {
            if (item.kind === "introduction" || item.kind === "takeaway") {
              return tokens;
            }
            if (item.kind === "inline_check_ref") {
              tokens.push({ kind: "check", sourceIndex });
            } else if (
              item.kind === "component_ref" ||
              item.kind === "component_intent" ||
              item.kind === "svg_ref"
            ) {
              tokens.push({ kind: "display", sourceIndex });
            } else {
              tokens.push({
                kind:
                  item.block.type === "heading"
                    ? "heading"
                    : item.block.type === "paragraph"
                      ? "paragraph"
                      : "display",
                sourceIndex,
                text:
                  item.block.type === "paragraph" ? item.block.text : undefined,
                selfNarrated: item.block.type === "display" && Boolean(item.block.document.root.build),
              });
            }
            return tokens;
          },
          [],
        );
        addNarratedMaterialSequenceIssues(narratedTokens, ctx);
      }
    }),
  );
}

export type ServerInlineCheckPlacement = {
  slotRef: string;
  targetLabel?: string;
};

function materialItemSearchText(item: MaterialGenerationJitItem): string {
  if (item.kind === "introduction" || item.kind === "takeaway") {
    return item.text;
  }
  if (item.kind === "component_ref") return "";
  if (item.kind === "component_intent") {
    return `${item.intent.setup} ${item.intent.learningGoal} ${item.intent.expectedInsight}`;
  }
  if (item.kind === "svg_ref") {
    return `${item.intent.setup} ${item.intent.learningGoal} ${item.intent.expectedInsight}`;
  }
  if (item.kind === "inline_check_ref") return "";
  const block = item.block;
  switch (block.type) {
            case "code":
      return typeof block.code === "string" ? block.code : "";
    case "heading":
    case "paragraph":
      return block.text;
    case "conversation":
      return `${block.title ?? ""} ${block.turns.map((turn) => `${turn.speaker} ${turn.text}`).join(" ")}`;
    case "callout":
      return `${block.title ?? ""} ${block.body}`;
    case "accordion":
      return `${block.title} ${block.body}`;
    case "illustration":
      return `${block.caption} ${block.prompt}`;
    case "stage":
      return `${block.layout} ${block.figures
        .map((figure) => {
          if (figure.type === "code") return figure.code;
          if (figure.type === "callout") {
            return `${figure.title ?? ""} ${figure.body}`;
          }
          if (figure.type === "accordion") {
            return `${figure.title} ${figure.body}`;
          }
          if (figure.type === "conversation") {
            return `${figure.title ?? ""} ${figure.turns
              .map((turn) => `${turn.speaker} ${turn.text}`)
              .join(" ")}`;
          }
          if (figure.type === "illustration") {
            return `${figure.caption} ${figure.prompt}`;
          }
          if (figure.type === "svg_slot") {
            return `${figure.intent.setup} ${figure.intent.learningGoal} ${figure.intent.expectedInsight}`;
          }
          return "";
        })
        .join(" ")}`;
    default:
      return "";
  }
}

function normalizedPlacementText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function placementMatchScore(text: string, targetLabel?: string): number {
  if (!targetLabel?.trim()) return 0;
  const normalizedText = normalizedPlacementText(text);
  const normalizedTarget = normalizedPlacementText(targetLabel);
  if (!normalizedText || !normalizedTarget) return 0;
  if (normalizedText.includes(normalizedTarget))
    return 1_000 + normalizedTarget.length;
  const labelParts = normalizedTarget
    .split(/[\s与和及、/,，:：;；()（）_-]+/u)
    .filter((part) => part.length >= 2);
  const parts = labelParts.flatMap((part) => {
    if (!/^\p{Script=Han}+$/u.test(part) || [...part].length <= 2) {
      return [part];
    }
    const characters = [...part];
    return [
      part,
      ...characters
        .slice(0, -1)
        .map((char, index) => `${char}${characters[index + 1]}`),
    ];
  });
  return [...new Set(parts)].reduce(
    (score, part) => score + (normalizedText.includes(part) ? part.length : 0),
    0,
  );
}

function interactiveSetupScore(text: string): number {
  const normalized = normalizedPlacementText(text);
  if (!normalized) return 0;

  // Prefer a learner invitation over earlier explanatory prose that happens
  // to repeat more vocabulary from the component intent.
  const patterns = [
    /(?:请|你|大家).{0,18}(?:试|练|排|拖|选|做|完成|操作|判断)/u,
    /(?:试着|动手|来|开始).{0,12}(?:排|拖|选|做|完成|操作|判断)/u,
    /(?:sort|order|drag|choose|try|practice|complete).{0,36}(?:step|sequence|workflow|exercise|activity)?/iu,
  ];
  return patterns.reduce(
    (score, pattern) => score + (pattern.test(normalized) ? 100 : 0),
    0,
  );
}

/**
 * Inline-check identities and placement are server-owned. Ignore any refs a
 * provider emits, then place target-aware checks after matching teaching
 * sections. Even distribution is the deterministic fallback when a target
 * label cannot be matched.
 */
export function injectServerInlineCheckRefs(
  items: readonly MaterialGenerationJitItem[],
  placements: readonly (string | ServerInlineCheckPlacement)[],
): MaterialGenerationJitItem[] {
  const authoredItems = items.filter(
    (item) => item.kind !== "inline_check_ref",
  );
  if (placements.length === 0) return authoredItems;
  const normalizedPlacements = placements.map((placement) =>
    typeof placement === "string" ? { slotRef: placement } : placement,
  );

  let placementCandidates = authoredItems.flatMap((item, index) => {
    if (item.kind === "component_ref") return [index];
    if (item.kind !== "block" || item.block.type === "heading") return [];
    return [index];
  });
  if (placementCandidates.length === 0) {
    placementCandidates = authoredItems.flatMap((item, index) =>
      item.kind === "block" || item.kind === "component_ref" ? [index] : [],
    );
  }
  if (placementCandidates.length === 0) {
    placementCandidates = [
      Math.max(
        0,
        authoredItems.findIndex((item) => item.kind === "introduction"),
      ),
    ];
  }

  const slotsAfterIndex = new Map<number, string[]>();
  normalizedPlacements.forEach((placement, slotIndex) => {
    const candidateIndex = Math.min(
      placementCandidates.length - 1,
      Math.max(
        0,
        Math.ceil(
          ((slotIndex + 1) * placementCandidates.length) /
            (normalizedPlacements.length + 1),
        ) - 1,
      ),
    );
    const fallbackIndex = placementCandidates[candidateIndex]!;
    const matchedHeading = authoredItems
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) => item.kind === "block" && item.block.type === "heading",
      )
      .map(({ item, index }) => ({
        index,
        level:
          item.kind === "block" && item.block.type === "heading"
            ? item.block.level
            : 3,
        score: placementMatchScore(
          materialItemSearchText(item),
          placement.targetLabel,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      )[0];
    let itemIndex = fallbackIndex;
    if (matchedHeading) {
      const nextPeerHeading = authoredItems.findIndex(
        (item, index) =>
          index > matchedHeading.index &&
          item.kind === "block" &&
          item.block.type === "heading" &&
          item.block.level <= matchedHeading.level,
      );
      const sectionEnd =
        nextPeerHeading < 0 ? authoredItems.length : nextPeerHeading;
      const sectionCandidates = placementCandidates.filter(
        (index) => index > matchedHeading.index && index < sectionEnd,
      );
      if (sectionCandidates.length > 0) {
        itemIndex = sectionCandidates.at(-1)!;
      }
    } else {
      const matchedContent = placementCandidates
        .map((index) => ({
          index,
          score: placementMatchScore(
            materialItemSearchText(authoredItems[index]!),
            placement.targetLabel,
          ),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) => right.score - left.score || right.index - left.index,
        )[0];
      if (matchedContent) itemIndex = matchedContent.index;
    }
    const slots = slotsAfterIndex.get(itemIndex) ?? [];
    slots.push(placement.slotRef);
    slotsAfterIndex.set(itemIndex, slots);
  });

  return authoredItems.flatMap((item, index) => [
    item,
    ...(slotsAfterIndex.get(index) ?? []).map((slotRef) => ({
      kind: "inline_check_ref" as const,
      slotRef,
    })),
  ]);
}

export function injectServerComponentRefs(
  items: readonly MaterialGenerationJitItem[],
  components: readonly {
    id: string;
    description: string;
  }[],
  options: {
    fallbackToTargetPlacement?: boolean;
  } = {},
): MaterialGenerationJitItem[] {
  const existingIds = new Set(
    items.flatMap((item) =>
      item.kind === "component_ref" ? [item.componentId] : [],
    ),
  );
  const missingComponents = components.filter(
    (component) => !existingIds.has(component.id),
  );
  if (missingComponents.length === 0) return [...items];

  const paragraphPairCandidates = items.flatMap((item, index) => {
    const next = items[index + 1];
    return item.kind === "block" &&
      item.block.type === "paragraph" &&
      next?.kind === "block" &&
      next.block.type === "paragraph"
      ? [index]
      : [];
  });
  const usedPairIndexes = new Set<number>();
  const refsAfterIndex = new Map<number, string[]>();
  const remainingComponents: typeof missingComponents = [];

  missingComponents.forEach((component) => {
    const availablePairs = paragraphPairCandidates.filter(
      (index) => !usedPairIndexes.has(index),
    );
    if (availablePairs.length === 0) {
      remainingComponents.push(component);
      return;
    }
    const scoredPairs = availablePairs
      .map((index) => ({
        index,
        score: placementMatchScore(
          `${materialItemSearchText(items[index]!)} ${materialItemSearchText(items[index + 1]!)}`,
          component.description,
        ),
        setupScore: interactiveSetupScore(
          materialItemSearchText(items[index]!),
        ),
      }))
      .sort(
        (left, right) =>
          right.setupScore - left.setupScore ||
          right.score - left.score ||
          left.index - right.index,
      );
    const bestMatchedPair = scoredPairs.find(({ score }) => score > 0);
    const pairIndex = bestMatchedPair?.index;
    if (pairIndex == null) {
      remainingComponents.push(component);
      return;
    }
    usedPairIndexes.add(pairIndex);
    refsAfterIndex.set(pairIndex, [
      ...(refsAfterIndex.get(pairIndex) ?? []),
      component.id,
    ]);
  });

  const placedBetweenNarration = items.flatMap((item, index) => [
    item,
    ...(refsAfterIndex.get(index) ?? []).map((componentId) => ({
      kind: "component_ref" as const,
      componentId,
    })),
  ]);
  if (options.fallbackToTargetPlacement === false) {
    return placedBetweenNarration;
  }
  const placed = injectServerInlineCheckRefs(
    placedBetweenNarration,
    remainingComponents.map((component) => ({
      slotRef: component.id,
      targetLabel: component.description,
    })),
  );
  return placed.map((item) =>
    item.kind === "inline_check_ref"
      ? {
          kind: "component_ref" as const,
          componentId: item.slotRef,
        }
      : item,
  );
}

type MaterialAssemblyItem = MaterialJitItem | MaterialGenerationJitItem;

function unresolvedMaterialPlaceholder(
  item: Extract<
    MaterialGenerationJitItem,
    {
      kind:
        "component_ref" | "component_intent" | "svg_ref" | "inline_check_ref";
    }
  >,
): InteractiveBlock {
  return item.kind === "svg_ref"
    ? {
        type: "placeholder",
        reason: "SVG diagram is being prepared",
        description: item.intent.learningGoal,
      }
    : item.kind === "component_ref"
      ? {
          type: "placeholder",
          reason: "interactive component is being prepared",
          description: `Waiting for planned component ${item.componentId}`,
        }
      : item.kind === "component_intent"
        ? {
            type: "placeholder",
            reason: "interactive component is being prepared",
            componentType: item.componentType,
            description: item.intent.learningGoal,
          }
        : {
            type: "placeholder",
            reason: "inline check is being prepared",
            componentType: "check",
            description: `Waiting for server slot ${item.slotRef}`,
          };
}

export function materialToJitItems(
  material: LearningMaterialContent,
): MaterialJitItem[] {
  const blocks = dedupeExactMaterialBlocks(material.blocks);
  return [
    { kind: "introduction", text: material.introduction },
    ...blocks.map((block) => ({ kind: "block" as const, block })),
    ...material.keyTakeaways.map((text) => ({
      kind: "takeaway" as const,
      text,
    })),
  ];
}

export const materialJitItemsSchema = z
  .array(materialJitItemSchema)
  .min(1)
  .superRefine((items, ctx) => {
    if (items.filter((item) => item.kind === "introduction").length > 1) {
      ctx.addIssue({
        code: "custom",
        message: "material allows at most one introduction item",
      });
    }
  });

export function nestedStageSvgFigureKey(
  itemIndex: number,
  figureIndex: number,
): string {
  return `svg:nested:${itemIndex}:${figureIndex}`;
}

export function assembleMaterialItems(
  items: readonly MaterialAssemblyItem[],
  resolved?: ReadonlyMap<number, InteractiveBlock | null>,
  nestedFigures?: ReadonlyMap<string, InteractiveBlock | null>,
): {
  material: LearningMaterialContent;
  unresolvedCount: number;
  completeBlockCount: number;
  placeholderBlockCount: number;
} {
  const introduction = items.find((item) => item.kind === "introduction");
  const blocks: InteractiveBlock[] = [];
  const keyTakeaways: string[] = [];
  let unresolvedCount = 0;
  let completeBlockCount = 0;
  items.forEach((item, index) => {
    if (item.kind === "block") {
      if (item.block.type === "stage") {
        const figures = item.block.figures.map((figure, figureIndex) => {
          if (figure.type !== "svg_slot") {
            return figure as InteractiveBlock;
          }
          return (
            nestedFigures?.get(nestedStageSvgFigureKey(index, figureIndex)) ??
            (figure as InteractiveBlock)
          );
        });
        blocks.push({ ...item.block, figures } as InteractiveBlock);
      } else {
        blocks.push(item.block as InteractiveBlock);
      }
      completeBlockCount += 1;
    } else if (item.kind === "takeaway") keyTakeaways.push(item.text);
    else if (
      item.kind === "component_ref" ||
      item.kind === "component_intent" ||
      item.kind === "svg_ref" ||
      item.kind === "inline_check_ref"
    ) {
      const compiled = resolved?.get(index);
      if (compiled) {
        blocks.push(compiled);
        completeBlockCount += 1;
      } else {
        blocks.push(unresolvedMaterialPlaceholder(item));
        unresolvedCount += 1;
      }
    }
  });
  const materialBlocks = dedupeExactMaterialBlocks(blocks);
  const material = {
    introduction: introduction?.text ?? "",
    blocks: materialBlocks,
    keyTakeaways,
  } as LearningMaterialContent;
  const placeholderBlockCount = materialBlocks.filter(
    (block) => block.type === "placeholder",
  ).length;
  return {
    material,
    unresolvedCount: placeholderBlockCount,
    completeBlockCount: materialBlocks.length - placeholderBlockCount,
    placeholderBlockCount,
  };
}

export const sqOutlineJitItemSchema = surveyOutlineItemSchema;
export const sqQuestionJitItemSchema = surveyQuestionItemSchema;
export const sqSectionPlanJitItemSchema = surveySectionPlanItemContractSchema;
export const sqJitItemSchema = surveyPreviewItemSchema;
export type SqJitItem = z.infer<typeof sqJitItemSchema>;
export const sqJitItemsSchema = z
  .array(surveyPreviewItemSchema)
  .min(2)
  .superRefine((items, context) => {
    if (items.filter((item) => item.kind === "section_plan").length > 1) {
      context.addIssue({
        code: "custom",
        message: "SQ allows at most one section plan",
      });
    }
    if (!items.some((item) => item.kind === "question")) {
      context.addIssue({
        code: "custom",
        message: "SQ requires a guiding question",
      });
    }
  });

export function invalidSqJitItemRepairs(
  items: ReadonlyArray<SqJitItem | undefined>,
  sourceItems: readonly unknown[] = items,
  options: { minimumOutlineItems?: number } = {},
): InvalidItemRepair<SqJitItem>[] {
  const sourceOutlineCount = sourceItems.filter(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).kind === "outline",
  ).length;
  const outlineCount = Math.max(
    options.minimumOutlineItems ?? 1,
    items.filter((item) => item?.kind === "outline").length,
    sourceOutlineCount,
  );
  const expectedIndexes = Array.from(
    { length: outlineCount },
    (_, index) => index,
  );

  return items.flatMap((item, index) => {
    if (item?.kind !== "section_plan") return [];
    const actualIndexes = item.sections.flatMap(
      (section) => section.outlineIndexes,
    );
    const coversOutlineExactly =
      actualIndexes.length === expectedIndexes.length &&
      actualIndexes.every(
        (outlineIndex, position) => outlineIndex === expectedIndexes[position],
      );
    return coversOutlineExactly
      ? []
      : [
          {
            index,
            description: `Correct the section plan so its 1-4 sections cover all ${outlineCount} Survey outline items in order, exactly once, using outlineIndexes 0 through ${outlineCount - 1}. Preserve the existing outline items.`,
            schema: sqSectionPlanJitItemSchema,
          },
        ];
  });
}

export function missingSqJitItemRepairs(
  validItems: SqJitItem[],
  sourceItems: unknown[] = validItems,
  options: { requireSectionPlan?: boolean; minimumOutlineItems?: number } = {},
): MissingItemRepair<SqJitItem>[] {
  const hasSourceKind = (kind: SqJitItem["kind"]) =>
    sourceItems.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).kind === kind,
    );
  const outlineCount = validItems.filter(
    (item) => item.kind === "outline",
  ).length;
  const sourceOutlineCount = sourceItems.filter(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).kind === "outline",
  ).length;
  const missingOutlineCount = Math.max(
    0,
    (options.minimumOutlineItems ?? 2) -
      Math.max(outlineCount, sourceOutlineCount),
  );
  return [
    ...Array.from({ length: missingOutlineCount }, (_, index) => ({
      description:
        "Add one missing narrow SQ outline section with scope, published learning-target refs, and checkpoint placement.",
      schema: sqOutlineJitItemSchema,
      insertAt: outlineCount + index,
    })),
    ...(options.requireSectionPlan &&
    !validItems.some((item) => item.kind === "section_plan") &&
    !hasSourceKind("section_plan")
      ? [
          {
            description:
              "Add the missing 1-4-section plan. Group all Survey outline indexes in order, exactly once; use one section when the unit is small.",
            schema: sqSectionPlanJitItemSchema,
            insertAt: Math.max(outlineCount, sourceOutlineCount),
          },
        ]
      : []),
    ...(validItems.some((item) => item.kind === "question") ||
    hasSourceKind("question")
      ? []
      : [
          {
            description:
              "Add the missing SQ guiding question using one published learning target.",
            schema: sqQuestionJitItemSchema,
          },
        ]),
  ];
}

export function assembleSqItems(
  items: SqJitItem[],
  learningTargets: z.infer<typeof unitLearningTargetSchema>[],
  options: {
    includeSectionOutline?: boolean;
    includeSectionPlan?: boolean;
  } = {},
): SqPreview {
  const outlineItems = items
    .filter(
      (item): item is Extract<SqJitItem, { kind: "outline" }> =>
        item.kind === "outline",
    )
    .slice(0, 8);
  const sectionPlan = items.find(
    (item): item is Extract<SqJitItem, { kind: "section_plan" }> =>
      item.kind === "section_plan",
  )?.sections;
  return {
    survey: {
      outline: outlineItems.map((item) => item.text),
      ...(learningTargets.length > 0 || options.includeSectionOutline
        ? {
            sectionOutline: outlineItems.map((item) => ({
              title: item.text,
              scope: item.scope?.trim() || item.text,
              learningTargetIds: item.learningTargetIds ?? [],
              checkpointAfter: item.checkpointAfter ?? false,
              ...(item.contentKind === "formal_derivation"
                ? { contentKind: "formal_derivation" as const }
                : {}),
            })),
          }
        : {}),
      ...(options.includeSectionPlan && sectionPlan ? { sectionPlan } : {}),
      learningTargetLabels: learningTargets.map((target) => target.label),
    },
    learningTargets,
    questions: items.flatMap((item) =>
      item.kind === "question" ? [item.question] : [],
    ),
  };
}

export const cornellJitItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), text: z.string().min(1) }),
  z.object({ kind: z.literal("cue"), text: z.string().min(1) }),
  z.object({ kind: z.literal("summary"), text: z.string().min(1) }),
]);
export type CornellJitItem = z.infer<typeof cornellJitItemSchema>;
export const cornellJitItemsSchema = z
  .array(cornellJitItemSchema)
  .min(3)
  .superRefine((items, ctx) => {
    if (!items.some((item) => item.kind === "note"))
      ctx.addIssue({
        code: "custom",
        message: "Cornell notes require a note item",
      });
    if (items.filter((item) => item.kind === "summary").length !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Cornell notes require one summary item",
      });
  });

export function assembleCornellItems(items: CornellJitItem[]) {
  return cornellSchema.parse({
    notes: items
      .flatMap((item) => (item.kind === "note" ? [item.text] : []))
      .join("\n"),
    cues: items
      .flatMap((item) => (item.kind === "cue" ? [item.text] : []))
      .join("\n"),
    summary: items.find((item) => item.kind === "summary")?.text ?? "",
  });
}

export const mapDomainJitItemSchema = z.object({
  kind: z.literal("domain"),
  domainTag: z.enum(["stem", "humanities", "general"]),
});
export const mapUnitJitItemSchema = z.object({
  kind: z.literal("unit"),
  unit: decomposeUnitSchema,
});
export const mapJitItemSchema = z.discriminatedUnion("kind", [
  mapDomainJitItemSchema,
  mapUnitJitItemSchema,
]);
export const mapJitItemBindingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("domain"),
    domainTag: z.enum(["stem", "humanities", "general"]),
  }),
  z.object({ kind: z.literal("unit"), unit: decomposeUnitBindingSchema }),
]);
export type MapJitItem = z.infer<typeof mapJitItemSchema>;
export const mapJitItemsSchema = z
  .array(mapJitItemSchema)
  .min(2)
  .superRefine((items, ctx) => {
    if (items.filter((item) => item.kind === "domain").length !== 1)
      ctx.addIssue({ code: "custom", message: "map requires one domain item" });
  });
export function assembleMapItems(items: MapJitItem[]): DecomposeResult {
  const domain = items.find((item) => item.kind === "domain");
  return decomposeResultSchema.parse({
    domainTag: domain?.domainTag ?? "general",
    units: items.flatMap((item) => (item.kind === "unit" ? [item.unit] : [])),
  });
}

export const subdivideJitItemSchema = z.object({
  kind: z.literal("unit"),
  unit: subdivideUnitSchema,
});
export type SubdivideJitItem = z.infer<typeof subdivideJitItemSchema>;
export const subdivideJitItemsSchema = z.array(subdivideJitItemSchema);
export function assembleSubdivideItems(
  items: SubdivideJitItem[],
): SubdivideResult {
  return subdivideResultSchema.parse({
    children: items.map((item) => item.unit),
  });
}

export const microUnitJitItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("metadata"),
    refinedTitle: z.string().optional(),
    topicScope: microTopicScopeSchema,
    topicOverview: z.string().min(1),
  }),
  z.object({
    kind: z.literal("lesson"),
    title: z.string().min(1),
    difficulty: z.enum(["easy", "medium", "hard"]),
    contentSummary: z.string().min(1),
  }),
]);
export type MicroUnitJitItem = z.infer<typeof microUnitJitItemSchema>;
export const microUnitJitItemsSchema = z
  .array(microUnitJitItemSchema)
  .length(2);
export function assembleMicroUnitItems(
  items: MicroUnitJitItem[],
): MicroUnitResult {
  const metadata = items.find((item) => item.kind === "metadata");
  const lesson = items.find((item) => item.kind === "lesson");
  return microUnitResultSchema.parse({
    refinedTitle: metadata?.refinedTitle,
    topicScope: metadata?.topicScope,
    topicOverview: metadata?.topicOverview,
    title: lesson?.title,
    difficulty: lesson?.difficulty,
    contentSummary: lesson?.contentSummary,
  });
}

export const quizJitItemSchema = z.preprocess(
  normalizeStreamQuizQuestion,
  quizQuestionSchema,
);
/** Provider-facing quiz item contract without preprocess/compatibility edits. */
export const quizJitItemBindingSchema = quizQuestionSchema;
export type QuizJitItem = QuizQuestion;

/**
 * Flashcards are generated as independent logical items. A malformed card can
 * therefore be repaired positionally without throwing away an otherwise valid
 * deck.
 */
export const flashcardJitItemSchema = flashCardDraftSchema;
export const flashcardJitItemBindingSchema = flashCardDraftSchema;
export type FlashcardJitItem = FlashCardDraft;

export const JIT_JSON_FORMATS = {
  sq: `{"items":[{"kind":"outline","text":"survey outline item","scope":"what this point covers","learningTargetIds":[],"checkpointAfter":true},{"kind":"question","text":"guiding question","learningTargetIds":["lt_1"]}]}`,
  cornell: `[
{"kind":"note","text":"distilled note"},
{"kind":"cue","text":"recall cue"},
{"kind":"summary","text":"2-4 sentence synthesis"}
]`,
  map: `[
{"kind":"domain","domainTag":"general"},
{"kind":"unit","unit":{"title":"...","difficulty":"medium","prerequisiteTitles":[],"contentSummary":"...","scope":"session"}}
]`,
  subdivide: `[
{"kind":"unit","unit":{"title":"...","difficulty":"medium","contentSummary":"..."}}
]`,
  micro: `[
{"kind":"metadata","refinedTitle":"...","topicScope":"focused","topicOverview":"..."},
{"kind":"lesson","title":"...","difficulty":"medium","contentSummary":"..."}
]`,
  material: `{"items":[{"type":"introduction","text":"..."},{"type":"heading","level":2,"text":"..."},{"type":"takeaway","text":"..."}]}`,
} as const;
