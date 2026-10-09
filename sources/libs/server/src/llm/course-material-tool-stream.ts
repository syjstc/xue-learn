import type { StreamTokenHandler } from "./chat-stream.js";
import { z } from "zod";
import {
  MAX_GENERATED_LEARNING_MATERIAL_BLOCKS,
  strictLearningMaterialSchema,
  type InteractiveBlock,
} from "./schemas.js";
import {
  assembleMaterialItems,
  createMaterialGenerationJitItemsSchema,
  injectServerComponentRefs,
  materialAuthoredBlockJitItemSchema,
  materialGenerationEnvelopeBindingSchema,
  materialGenerationJitItemBindingSchema,
  materialGenerationJitItemSchema,
  nestedStageSvgFigureKey,
  normalizeMaterialGenerationEnvelopeCandidate,
  type MaterialGenerationJitItem,
} from "./jit-structured-items.js";
import {
  runValidatedStructuredGeneration,
  StructuredGenerationError,
} from "./validated-structured-generation.js";
import { improveLearningMaterialCode } from "../markdown/code-quality.js";
import {
  normalizeGeneratedText,
  runSinglePositionalRepair,
} from "./structured-recovery.js";
import { compileComponentIntent } from "./course-material-component-compiler.js";
import { compileTeachingDiagram } from "./course-material-svg-generator.js";
import {
  compileCourseMaterialInlineCheck,
  planCourseMaterialInlineChecks,
  type InlineCheckContext,
} from "./course-material-inline-checks.js";
import {
  isLabActivityComponentType,
  LAB_ACTIVITY_COMPONENT_TYPES,
  VISUAL_RENDERER_PRIORITY_RULE,
  type MaterialGenerationPolicy,
} from "./component-dsl-registry.js";
import { patchActiveLlmRecoveryMetadata } from "./logger.js";
import {
  MAX_KEY_TAKEAWAYS,
  MIN_LEARNING_MATERIAL_BLOCKS,
} from "./normalize-learning-material.js";
import type { LearningSystemSubject } from "../learning-systems/types.js";
import { runWithIsolatedLlmSpanAsync } from "./trace-context.js";
import {
  componentCompilationFallback,
  svgCompilationFallback,
} from "../material/intent-orchestration.js";
import { COURSE_SVG_SLOT_INTENT_CONTRACT, formatCourseSvgIntent } from "./course-svg-intent.js";

const SVG_GENERATION_CONCURRENCY = 4;

export function normalizedCheckQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s?？!！.,，。:：;；'"“”‘’`´]+/gu, "");
}

/** Normalize authored prose while preserving significant code whitespace. */
export function normalizeMaterialGeneratedJsonValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeGeneratedText(value);
  if (Array.isArray(value)) {
    return value.map(normalizeMaterialGeneratedJsonValue);
  }
  if (!value || typeof value !== "object") return value;

  const object = value as Record<string, unknown>;
  const isCodeBlock =
    object.type === "code" &&
    (typeof object.code === "string" || Array.isArray(object.parts));
  return Object.fromEntries(
    Object.entries(object).flatMap(([key, child]) => {
      if (child === null) return [];
      if (isCodeBlock && (key === "code" || key === "parts")) {
        return [[key, child] as const];
      }
      return [[key, normalizeMaterialGeneratedJsonValue(child)] as const];
    }),
  );
}

function unwrapCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return match?.[1] ?? value;
}

function localizedSectionTitle(
  language: string,
  kind: "interactive" | "questions",
): string {
  const normalized = language.toLowerCase();
  if (normalized.startsWith("en")) {
    return kind === "interactive"
      ? "Independent practice"
      : "Section questions";
  }
  if (normalized.includes("hant") || normalized.includes("tw")) {
    return kind === "interactive" ? "獨立互動練習" : "小節測驗";
  }
  return kind === "interactive" ? "独立互动练习" : "小节测验";
}

function appendServerOwnedSection(
  items: readonly MaterialGenerationJitItem[],
  refs: readonly MaterialGenerationJitItem[],
  title: string,
): MaterialGenerationJitItem[] {
  if (refs.length === 0) return [...items];
  const takeawayIndex = items.findIndex((item) => item.kind === "takeaway");
  const insertAt = takeawayIndex < 0 ? items.length : takeawayIndex;
  return [
    ...items.slice(0, insertAt),
    {
      kind: "block" as const,
      block: { type: "heading" as const, level: 2 as const, text: title },
    },
    ...refs,
    ...items.slice(insertAt),
  ];
}

/**
 * Streams a flat provider-facing root array. Every preview block
 * has passed its item schema. Parsed component_slot / svg_slot items emit a
 * loading placeholder immediately and start their compiler without waiting
 * for the remaining authored blocks. Inline checks stay server-owned and are
 * still appended after authoring completes.
 */
export async function streamCourseMaterialItems(
  prompt: string,
  options: {
    onToken?: StreamTokenHandler;
    onMaterialUpdate?: (partial: {
      material: ReturnType<typeof assembleMaterialItems>["material"];
      completeBlockCount: number;
      placeholderBlockCount: number;
    }) => void | Promise<void>;
    signal?: AbortSignal;
    operation?: string;
    meta?: Record<string, unknown>;
    contextSubject?: LearningSystemSubject;
    contextQuery?: string;
    contextInvocation?: unknown;
    generationPolicy?: MaterialGenerationPolicy;
    componentContext: {
      unitTitle: string;
      language: string;
      context: string;
      authoringScope?: {
        userId: string;
        goalId: string;
        unitId: string;
      };
    };
    inlineCheckContext?: InlineCheckContext;
    authorItems?: (input: {
      prompt: string;
      resultSchema: z.ZodType<MaterialGenerationJitItem[]>;
      onToken?: StreamTokenHandler;
      onPartial: (items: MaterialGenerationJitItem[]) => void | Promise<void>;
      signal?: AbortSignal;
    }) => Promise<MaterialGenerationJitItem[]>;
  },
): Promise<{
  items: MaterialGenerationJitItem[];
  material: ReturnType<typeof assembleMaterialItems>["material"];
}> {
  const operation = options.operation ?? "unit.learning_material";
  const authoringStartedAt = Date.now();
  let firstValidBlockRecorded = false;
  const inlinePlans = options.inlineCheckContext
    ? planCourseMaterialInlineChecks(options.inlineCheckContext)
    : [];
  const expectedSlots = inlinePlans.map((plan) => plan.slotRef);
  const generationPolicy: MaterialGenerationPolicy =
    options.generationPolicy ?? {
      allowedComponentTypes: [],
      maxComponentCount: 0,
      allowIllustrations: false,
      plannedComponents: [],
    };
  const plannedComponents = generationPolicy.plannedComponents ?? [];
  const inlineComponents = plannedComponents.filter(
    (component) => !LAB_ACTIVITY_COMPONENT_TYPES.has(component.componentType),
  );
  const inLessonAllowedTypes = generationPolicy.allowedComponentTypes.filter(
    (type) => !LAB_ACTIVITY_COMPONENT_TYPES.has(type),
  );
  const serverSectionHeadingCount = inlinePlans.length > 0 ? 1 : 0;
  const plannedIds = new Set(inlineComponents.map((component) => component.id));
  const allowedTypes = new Set(inLessonAllowedTypes);
  if (
    inlineComponents.length > generationPolicy.maxComponentCount ||
    plannedIds.size !== inlineComponents.length ||
    inlineComponents.some(
      (component) => !allowedTypes.has(component.componentType),
    )
  ) {
    throw new StructuredGenerationError(operation, "validation", 1, [
      "frozen component plan violates the material generation policy",
    ]);
  }
  let compilationAbortError: unknown;
  let componentFallbackCount = 0;
  const workAbortController = new AbortController();
  const workSignal = options.signal
    ? AbortSignal.any([options.signal, workAbortController.signal])
    : workAbortController.signal;
  const resolvedByKey = new Map<string, InteractiveBlock | null>();
  // A compiler may publish a usable first preview before its audit/repair pass
  // has finished. Keep that work visible as pending even though the placeholder
  // has already been replaced by the preview on screen.
  const refiningPreviewKeys = new Set<string>();
  let currentItems: MaterialGenerationJitItem[] = [];
  let parserPlaceholders = 0;
  let updateQueue = Promise.resolve();
  const componentById = new Map(
    plannedComponents.map((component) => [component.id, component] as const),
  );

  const itemKey = (
    item: MaterialGenerationJitItem,
    index?: number,
    list: readonly MaterialGenerationJitItem[] = currentItems,
  ) => {
    if (item.kind === "component_ref") return `component:${item.componentId}`;
    if (item.kind === "inline_check_ref") return `inline:${item.slotRef}`;
    if (item.kind !== "component_intent" && item.kind !== "svg_ref") {
      return undefined;
    }
    const at = index ?? list.indexOf(item);
    if (at < 0) return undefined;
    // Native structured streaming publishes cumulative snapshots. A valid
    // intent can therefore be observed several times while its text is still
    // changing. Use the slot's ordinal among its intent kind, not mutable
    // intent text or the absolute item index, so inserted server-owned items
    // cannot cause a second compiler call for the same authored slot.
    const ordinal = list
      .slice(0, at + 1)
      .filter((candidate) => candidate.kind === item.kind).length;
    return item.kind === "component_intent"
      ? `component-intent:${ordinal}`
      : `svg:${ordinal}`;
  };

  const emit = () => {
    const resolved = new Map<number, InteractiveBlock | null>();
    const nestedFigures = new Map<string, InteractiveBlock | null>();
    currentItems.forEach((item, index) => {
      const key = itemKey(item, index);
      if (key && resolvedByKey.has(key)) {
        resolved.set(index, resolvedByKey.get(key) ?? null);
      }
      if (item.kind === "block" && item.block.type === "stage") {
        item.block.figures.forEach((_, figureIndex) => {
          const nestedKey = nestedStageSvgFigureKey(index, figureIndex);
          if (resolvedByKey.has(nestedKey)) {
            nestedFigures.set(nestedKey, resolvedByKey.get(nestedKey) ?? null);
          }
        });
      }
    });
    const assembled = assembleMaterialItems(
      currentItems,
      resolved,
      nestedFigures,
    );
    const refiningPreviewCount = currentItems.reduce((count, item, index) => {
      const key = itemKey(item, index);
      return count + (key && refiningPreviewKeys.has(key) ? 1 : 0);
    }, 0);
    updateQueue = updateQueue.then(async () => {
      await options.onMaterialUpdate?.({
        material: assembled.material,
        completeBlockCount: assembled.completeBlockCount,
        placeholderBlockCount:
          parserPlaceholders +
          assembled.placeholderBlockCount +
          refiningPreviewCount,
      });
    });
    return updateQueue;
  };

  const componentTasks = new Map<string, Promise<InteractiveBlock>>();
  const startComponentCompilation = (
    item: Extract<
      MaterialGenerationJitItem,
      { kind: "component_ref" | "component_intent" }
    >,
    lessonItems: readonly MaterialGenerationJitItem[],
    itemIndex?: number,
  ) => {
    const component =
      item.kind === "component_ref"
        ? componentById.get(item.componentId)
        : {
            id: `authored_${itemIndex ?? lessonItems.indexOf(item)}`,
            componentType: item.componentType,
            description: item.intent.learningGoal,
          };
    const key = itemKey(
      item,
      itemIndex ?? lessonItems.indexOf(item),
      lessonItems,
    );
    if (!component || !key) return undefined;
    if (LAB_ACTIVITY_COMPONENT_TYPES.has(component.componentType)) {
      return undefined;
    }
    const existing = componentTasks.get(key);
    if (existing) return existing;
    const contextualIntent = item.intent
      ? `${item.intent.setup}\nLearning goal: ${item.intent.learningGoal}\nExpected insight: ${item.intent.expectedInsight}`
      : component.description;
    const slotIndex = itemIndex ?? lessonItems.indexOf(item);
    const nearbyLessonContext =
      slotIndex < 0
        ? ""
        : JSON.stringify(
            lessonItems.slice(Math.max(0, slotIndex - 4), slotIndex + 3),
          ).slice(0, 6_000);
    // Component compilers run concurrently. Give each one a private mutable
    // active-span ref so a sibling provider call cannot steal the final
    // business-validation patch and leave an invalid component logged as a
    // schema-stage success.
    const task = runWithIsolatedLlmSpanAsync(() =>
      compileComponentIntent({
        intent: {
          type: component.componentType,
          description: contextualIntent,
        },
        ...options.componentContext,
        context: `${options.componentContext.context}\n\nLesson-local component intent:\n${contextualIntent}${nearbyLessonContext ? `\n\nNearby authored lesson items (slot position is authoritative):\n${nearbyLessonContext}` : ""}`,
        signal: workSignal,
        meta: {
          ...options.meta,
          componentId: component.id,
          contextualSlot: Boolean(item.intent),
        },
        onPartial: async (partial) => {
          resolvedByKey.set(key, partial);
          refiningPreviewKeys.add(key);
          await emit();
        },
      }),
    )
      .catch((error) => {
        if (options.signal?.aborted) compilationAbortError = error;
        return null;
      })
      .then(async (block) => {
        const resolved =
          block ??
          componentCompilationFallback(
            component.componentType,
            component.description,
          );
        if (!block) componentFallbackCount += 1;
        resolvedByKey.set(key, resolved);
        refiningPreviewKeys.delete(key);
        if (
          currentItems.some((current, index) => itemKey(current, index) === key)
        ) {
          await emit();
        }
        return resolved;
      });
    componentTasks.set(key, task);
    return task;
  };
  const svgTasks = new Map<string, Promise<InteractiveBlock>>();
  let svgInFlight = 0;
  const svgWaiters: Array<() => void> = [];
  const acquireSvgSlot = async () => {
    while (svgInFlight >= SVG_GENERATION_CONCURRENCY) {
      await new Promise<void>((resolve) => {
        svgWaiters.push(resolve);
      });
    }
    svgInFlight += 1;
  };
  const releaseSvgSlot = () => {
    svgInFlight = Math.max(0, svgInFlight - 1);
    svgWaiters.shift()?.();
  };
  const startSvgCompilation = (
    item: Extract<MaterialGenerationJitItem, { kind: "svg_ref" }>,
    lessonItems: readonly MaterialGenerationJitItem[],
    itemIndex?: number,
  ) => {
    const slotIndex = itemIndex ?? lessonItems.indexOf(item);
    const key = itemKey(item, slotIndex, lessonItems);
    if (!key) return undefined;
    return startSvgCompilationByKey(key, item.intent, slotIndex, lessonItems);
  };
  const startSvgCompilationByKey = (
    key: string,
    intent: Extract<MaterialGenerationJitItem, { kind: "svg_ref" }>["intent"],
    slotIndex: number,
    lessonItems: readonly MaterialGenerationJitItem[] = currentItems,
  ) => {
    const existing = svgTasks.get(key);
    if (existing) return existing;
    const nearbyLessonContext =
      slotIndex < 0
        ? ""
        : JSON.stringify(
            lessonItems.slice(Math.max(0, slotIndex - 4), slotIndex + 3),
          ).slice(0, 6_000);
    const task = (async () => {
      await acquireSvgSlot();
      try {
        const block = await runWithIsolatedLlmSpanAsync(() =>
          compileTeachingDiagram({
            intent,
            ...options.componentContext,
            context: `${options.componentContext.context}\n\nLesson-local SVG intent:\n${formatCourseSvgIntent(intent)}${nearbyLessonContext ? `\n\nNearby authored lesson items (slot position is authoritative):\n${nearbyLessonContext}` : ""}`,
            signal: workSignal,
            meta: { ...options.meta, svgSlotIndex: slotIndex },
            onPartial: async (partial) => {
              resolvedByKey.set(key, partial);
              refiningPreviewKeys.add(key);
              await emit();
            },
          }),
        ).catch((error) => {
          if (options.signal?.aborted) compilationAbortError = error;
          return null;
        });
        const resolved = block ?? svgCompilationFallback(intent);
        if (!block) componentFallbackCount += 1;
        resolvedByKey.set(key, resolved);
        refiningPreviewKeys.delete(key);
        await emit();
        return resolved;
      } finally {
        releaseSvgSlot();
      }
    })();
    svgTasks.set(key, task);
    return task;
  };
  const startNestedStageSvgCompilation = (
    lessonItems: readonly MaterialGenerationJitItem[],
  ) => {
    lessonItems.forEach((item, index) => {
      if (item.kind !== "block" || item.block.type !== "stage") return;
      item.block.figures.forEach((figure, figureIndex) => {
        if (figure.type !== "svg_slot") return;
        startSvgCompilationByKey(
          nestedStageSvgFigureKey(index, figureIndex),
          figure.intent as Extract<
            MaterialGenerationJitItem,
            { kind: "svg_ref" }
          >["intent"],
          index,
          lessonItems,
        );
      });
    });
  };
  const inlineTasks = new Map(
    inlinePlans.map((plan) => [
      plan.slotRef,
      runWithIsolatedLlmSpanAsync(() =>
        compileCourseMaterialInlineCheck({
          plan,
          ...options.componentContext,
          signal: workSignal,
          operation: `${operation}.inline_check`,
          meta: options.meta,
        }),
      ).catch((error) => {
        if (options.signal?.aborted) compilationAbortError = error;
        return null;
      }),
    ]),
  );

  const itemListSchema = createMaterialGenerationJitItemsSchema({
    policy: {
      ...generationPolicy,
      plannedComponents: inlineComponents,
    },
    reservedServerBlockCount:
      expectedSlots.length +
      inlineComponents.length +
      serverSectionHeadingCount,
    requirePlannedComponents: false,
    enforceNarratedSequence: true,
  });
  let authoredItems: MaterialGenerationJitItem[];
  const publishAuthoredPartial = async (
    partialItems: MaterialGenerationJitItem[],
    placeholders: number,
  ) => {
    const safePartialItems = partialItems.filter(
      (item) => item.kind !== "inline_check_ref",
    );
    safePartialItems.forEach((item, index) => {
      if (item.kind === "component_ref" || item.kind === "component_intent") {
        startComponentCompilation(item, safePartialItems, index);
      }
      if (item.kind === "svg_ref") {
        startSvgCompilation(item, safePartialItems, index);
      }
    });
    startNestedStageSvgCompilation(safePartialItems);
    currentItems = safePartialItems;
    if (
      !firstValidBlockRecorded &&
      currentItems.some((item) => item.kind === "block")
    ) {
      firstValidBlockRecorded = true;
      await patchActiveLlmRecoveryMetadata({
        firstValidMaterialBlockMs: Date.now() - authoringStartedAt,
      });
    }
    parserPlaceholders = placeholders;
    await emit();
  };
  try {
    authoredItems = options.authorItems
      ? await options.authorItems({
          prompt,
          resultSchema: itemListSchema,
          onToken: options.onToken,
          onPartial: (items) => publishAuthoredPartial(items, 0),
          signal: options.signal,
        })
      : await runValidatedStructuredGeneration<
          MaterialGenerationJitItem,
          { items: MaterialGenerationJitItem[]; placeholders: number },
          MaterialGenerationJitItem[]
        >(
          {
            mode: "item-array",
            operation,
            prompt,
            contextSubject: options.contextSubject,
            contextQuery: options.contextQuery,
            contextInvocation: options.contextInvocation,
            itemSchema: materialGenerationJitItemSchema,
            bindingItemSchema: materialGenerationJitItemBindingSchema,
            nativeEnvelopeBindingSchema:
              materialGenerationEnvelopeBindingSchema,
            normalizeNativeEnvelopeCandidate:
              normalizeMaterialGenerationEnvelopeCandidate,
            resultSchema: itemListSchema,
            assemble: (value) => value,
            assemblePartial: (value, placeholders) => ({
              items: value,
              placeholders,
            }),
            repairContext: `Lesson title: ${options.componentContext.unitTitle}
Language requirement: write every repaired user-facing field in ${options.componentContext.language}, matching the source lesson. Never use generic placeholder or template text. Never introduce a subject that is absent from the original lesson request.
Original lesson-generation request excerpt:
${prompt.slice(0, 3_000)}
Retrieved/source context excerpt:
${options.componentContext.context.slice(0, 3_000)}
Provider item wire shapes:
{"type":"introduction","text":"learner-specific opener"}
{"type":"heading","level":2,"text":"..."}
{"type":"paragraph","text":"...","cue":{"target":"whole"}}
{"type":"conversation","title":"optional scene or purpose","turns":[{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}]}
{"type":"callout","variant":"tip|warning|definition|example","title":"optional","body":"..."}
{"type":"accordion","title":"...","body":"..."}
${COURSE_SVG_SLOT_INTENT_CONTRACT}
Stage displays may contain 2–4 figures. Preserve a valid fourth figure during repair; the legacy 2–3 wording above is obsolete.
${generationPolicy.allowIllustrations ? '{"type":"illustration","caption":"...","prompt":"English image prompt without text","style":"diagram|process|concept|comparison","aspectRatio":"16:9"}' : "Illustration blocks are disabled."}
{"type":"takeaway","text":"..."}
For the provider-native envelope, return one growing items array of plain JSON objects (typed items only). The final array must contain at least ${MIN_LEARNING_MATERIAL_BLOCKS} content items: introduction, teaching blocks, component slots, and SVG slots count; takeaways do not. Prefer an optional {"type":"introduction","text":"..."} opener first, then teaching blocks, then optional takeaways — but introduction is not required; teaching blocks alone are enough to publish. Every narrated topic must follow heading → display → paragraph+ → [display → paragraph+]*. Display is one atomic figure or one stage of 2–4 ordinary subviews. Use stage subviews for comparisons; never emit compare, including inside a stage. A paragraph is one voice-ready beat of at most three short sentences; lists, coordinates, or stage directions are not allowed (inline $...$ matching the board is fine). Every paragraph after a display must include paragraph.cue (whole after a single figure; a layout slot after stage; part ids after code). Streaming partial arguments is fine, but the final commit must never contain an empty or partial items array. Do not encode items as JSON strings. Keep every authored block directly in the root array when positional repair requests an item array; never emit kind or block wrappers there. Use conversation for a dialogue or interview and put exactly one speaker turn in each turns item; never flatten several turns into paragraph/callout prose. ${inlineComponents.length > 0 ? 'For every frozen in-lesson visual, place exactly one {"type":"component_slot","slotRef":"component_N","intent":{"setup":"what the learner sees here","learningGoal":"the precise lesson-local objective","expectedInsight":"what the learner should notice"}} followed immediately by at least one narration paragraph. Use only the supplied frozen slotRef.' : inLessonAllowedTypes.length > 0 ? `You may author as many distinct useful in-lesson visuals as the section needs as {"type":"component_slot","componentType":"one of ${inLessonAllowedTypes.join("|")}","intent":{"setup":"what the learner sees here","learningGoal":"the precise lesson-local objective","expectedInsight":"what the learner should notice"}}. Follow each with at least one narration paragraph. math_scene is the only optional in-lesson component family, not a lab item; never emit chart components or lab types.` : "Do not emit component_slot items."} Never author executable component JSON. ${VISUAL_RENDERER_PRIORITY_RULE} There is no SVG or math_scene count quota, but every visual must be distinct and useful. Every svg_slot must declare visualKind, a composition that specifies the picture layout, and specific elements, relationships, and labels; follow it with narration. These fields are the semantic brief for the parallel SVG compiler so later redraws stay the same picture. Never author SVG markup in this call. Inline-check references are server-owned. Direct items cannot be check, placeholder, or a complex executable component. Stage figure repairs must preserve 2–4 figures. The legacy 2–3 phrase above is obsolete; never remove a valid fourth stage figure.`,
            // Prefer the provider-native canonical material envelope. The shared
            // item-array runner falls back to the raw root-array parser only when
            // the provider's structured-output methods are unavailable or fail.
            preferRawStream: false,
            // Item objects keep discriminator-specific fields. DeepSeek/OpenAI
            // strict cannot represent that without a json-string wrapper, so use
            // ordinary function calling and keep Zod as the authority.
            preferSchemaConstrained: false,
            deepseekStrictOnly: false,
            // Valid authored items are authoritative. Repair only the invalid or
            // missing positions; never regenerate the complete material envelope.
            repairInvalidItemsOnly: true,
            rawStreamFormat: "json-array",
            regenerateOnFailure: false,
            maxRepairAttempts: 1,
            recoveryPolicy: {
              normalizeItem: normalizeMaterialGeneratedJsonValue,
              dedupeExact: true,
              normalize: (items) => {
                const firstIntroduction = items.find(
                  (item) => item.kind === "introduction",
                );
                let blockCount = 0;
                let takeawayCount = 0;
                const authoredBlockLimit = Math.max(
                  MIN_LEARNING_MATERIAL_BLOCKS,
                  MAX_GENERATED_LEARNING_MATERIAL_BLOCKS -
                    expectedSlots.length -
                    inlineComponents.length -
                    serverSectionHeadingCount,
                );
                const rest = items.filter((item) => {
                  if (item.kind === "introduction") return false;
                  if (item.kind === "block") {
                    if (blockCount >= authoredBlockLimit) return false;
                    blockCount += 1;
                    return true;
                  }
                  if (item.kind === "takeaway") {
                    if (takeawayCount >= MAX_KEY_TAKEAWAYS) return false;
                    takeawayCount += 1;
                  }
                  return true;
                });
                const normalized = firstIntroduction
                  ? [firstIntroduction, ...rest]
                  : rest;
                return {
                  items: normalized,
                  droppedCount: items.length - normalized.length,
                };
              },
              maxItems: 132,
              missingItems: ({ validItems, sourceItems }) => {
                const repairs = [];
                const sourceRecords = sourceItems.flatMap((item) =>
                  item && typeof item === "object" && !Array.isArray(item)
                    ? [item as Record<string, unknown>]
                    : [],
                );
                // Introduction is an optional typed opener — do not force-repair it.
                const isContentUnit = (item: { kind?: unknown }) =>
                  item.kind === "introduction" ||
                  item.kind === "block" ||
                  item.kind === "component_ref" ||
                  item.kind === "component_intent" ||
                  item.kind === "svg_ref";
                const currentContentCount =
                  validItems.filter(isContentUnit).length;
                const addressableSourceContentCount =
                  sourceRecords.filter(isContentUnit).length;
                const projectedContentCount = Math.max(
                  currentContentCount,
                  addressableSourceContentCount,
                );
                for (
                  let index = projectedContentCount;
                  index < MIN_LEARNING_MATERIAL_BLOCKS;
                  index += 1
                ) {
                  repairs.push({
                    description: `Add missing lesson content item ${index + 1} of ${MIN_LEARNING_MATERIAL_BLOCKS}.`,
                    schema: materialAuthoredBlockJitItemSchema,
                  });
                }
                return repairs;
              },
            },
            meta: options.meta,
            contract: {
              sizeProfile: "long",
              transportPolicy: "provider-canonical-object-envelope",
              recoveryPolicy: "single-positional-repair",
            },
          },
          {
            onToken: options.onToken,
            signal: options.signal,
            onPartial: ({ items, placeholders }) =>
              publishAuthoredPartial(items, placeholders),
          },
        );
  } catch (error) {
    workAbortController.abort(error);
    throw error;
  }
  const itemsWithInlineComponents = injectServerComponentRefs(
    authoredItems,
    inlineComponents,
  );
  const inlineAuthoredItems = itemsWithInlineComponents.filter(
    (item) =>
      !(
        item.kind === "component_intent" &&
        isLabActivityComponentType(item.componentType)
      ) &&
      !(
        item.kind === "component_ref" &&
        isLabActivityComponentType(
          componentById.get(item.componentId)?.componentType ?? "",
        )
      ),
  );
  const authoredWithoutCheckRefs = inlineAuthoredItems.filter(
    (item) => item.kind !== "inline_check_ref",
  );
  const items = appendServerOwnedSection(
    authoredWithoutCheckRefs,
    inlinePlans.map((plan) => ({
      kind: "inline_check_ref" as const,
      slotRef: plan.slotRef,
    })),
    localizedSectionTitle(options.componentContext.language, "questions"),
  );
  items.forEach((item, index) => {
    if (item.kind === "component_ref" || item.kind === "component_intent") {
      startComponentCompilation(item, items, index);
    }
    if (item.kind === "svg_ref") {
      startSvgCompilation(item, items, index);
    }
  });
  startNestedStageSvgCompilation(items);
  currentItems = items;
  parserPlaceholders = 0;
  await emit();
  const finalComponentKeys = new Set(
    items.flatMap((item, index) =>
      item.kind === "component_ref" || item.kind === "component_intent"
        ? [itemKey(item, index)!]
        : [],
    ),
  );
  const finalSvgKeys = new Set(
    items.flatMap((item, index) => [
      ...(item.kind === "svg_ref" ? [itemKey(item, index)!] : []),
      ...(item.kind === "block" && item.block.type === "stage"
        ? item.block.figures.flatMap((figure, figureIndex) =>
            figure.type === "svg_slot"
              ? [nestedStageSvgFigureKey(index, figureIndex)]
              : [],
          )
        : []),
    ]),
  );
  const finalInlineSlots = new Set(
    items.flatMap((item) =>
      item.kind === "inline_check_ref" ? [item.slotRef] : [],
    ),
  );
  const [, , compiledInlineEntries] = await Promise.all([
    Promise.all(
      [...finalComponentKeys].flatMap((key) => {
        const task = componentTasks.get(key);
        return task ? [task] : [];
      }),
    ),
    Promise.all(
      [...finalSvgKeys].flatMap((key) => {
        const task = svgTasks.get(key);
        return task ? [task] : [];
      }),
    ),
    Promise.all(
      [...finalInlineSlots].map(
        async (slotRef) =>
          [slotRef, (await inlineTasks.get(slotRef)) ?? null] as const,
      ),
    ),
  ]);
  for (const [slotRef, block] of compiledInlineEntries) {
    resolvedByKey.set(`inline:${slotRef}`, block);
  }
  if (compilationAbortError) throw compilationAbortError;
  options.signal?.throwIfAborted();

  const usedQuestions = new Map<string, string>();
  for (const plan of inlinePlans) {
    const key = `inline:${plan.slotRef}`;
    const block = resolvedByKey.get(key);
    if (!block || block.type !== "check") continue;
    const normalized = normalizedCheckQuestion(block.question);
    if (!usedQuestions.has(normalized)) {
      usedQuestions.set(normalized, block.question);
      continue;
    }
    const replacement = await compileCourseMaterialInlineCheck({
      plan,
      ...options.componentContext,
      avoidQuestions: [...usedQuestions.values()],
      signal: workSignal,
      operation: `${operation}.inline_check`,
      meta: { ...options.meta, duplicateQuestionRetry: true },
    }).catch((error) => {
      if (options.signal?.aborted) compilationAbortError = error;
      return null;
    });
    const replacementNormalized = replacement
      ? normalizedCheckQuestion(replacement.question)
      : "";
    if (!replacement || usedQuestions.has(replacementNormalized)) {
      resolvedByKey.set(key, null);
      continue;
    }
    resolvedByKey.set(key, replacement);
    usedQuestions.set(replacementNormalized, replacement.question);
  }
  if (compilationAbortError) throw compilationAbortError;
  await updateQueue;
  const failedRequired = items.flatMap((item, index) =>
    item.kind === "inline_check_ref" && !resolvedByKey.get(itemKey(item)!)
      ? [index]
      : [],
  );
  if (failedRequired.length > 0) {
    throw new StructuredGenerationError(operation, "tool-call", 3, [
      `required material items failed compilation at indexes ${failedRequired.join(", ")}`,
    ]);
  }
  const resolved = new Map<number, InteractiveBlock | null>();
  const nestedFigures = new Map<string, InteractiveBlock | null>();
  items.forEach((item, index) => {
    const key = itemKey(item, index);
    if (key) resolved.set(index, resolvedByKey.get(key) ?? null);
    if (item.kind === "block" && item.block.type === "stage") {
      item.block.figures.forEach((_, figureIndex) => {
        const nestedKey = nestedStageSvgFigureKey(index, figureIndex);
        if (resolvedByKey.has(nestedKey)) {
          nestedFigures.set(nestedKey, resolvedByKey.get(nestedKey) ?? null);
        }
      });
    }
  });
  const assembled = assembleMaterialItems(items, resolved, nestedFigures);
  let codeImprovedMaterial: typeof assembled.material;
  let repairedCodeBlockCount = 0;
  let codeFallbackCount = 0;
  try {
    codeImprovedMaterial = await improveLearningMaterialCode(
      assembled.material,
      {
        repairInvalidCode: async ({ source, language, error }) => {
          const [repaired] = await runSinglePositionalRepair({
            operation: `${operation}.code`,
            slots: [
              {
                description: `Repair only this ${language} source block after syntax validation failed (${error.message}). Correct syntax or indentation while preserving its teaching intent, identifiers, comments, and behavior. Return raw source code without a markdown fence.`,
                context: `Lesson title: ${options.componentContext.unitTitle}\nLearner-facing language: ${options.componentContext.language}\nLesson context excerpt: ${options.componentContext.context.slice(0, 3_000)}`,
                currentValue: source,
                schema: z.string().min(1).max(64_000),
                expectedShape: `One raw, syntactically valid ${language} source string. Do not return markdown fences, prose, or a replacement lesson block.`,
              },
            ],
            meta: {
              ...options.meta,
              codeLanguage: language,
              localizedMaterialRepair: true,
            },
            signal: options.signal,
          });
          repairedCodeBlockCount += 1;
          return unwrapCodeFence(repaired ?? source);
        },
        preserveInvalidCodeAsText: true,
        onInvalidCodeFallback: () => {
          codeFallbackCount += 1;
        },
      },
    );
  } catch (error) {
    throw new StructuredGenerationError(operation, "validation", 1, [
      `generated code fence failed syntax validation: ${
        error instanceof Error ? error.message : "invalid source"
      }`,
    ]);
  }
  const material = strictLearningMaterialSchema.parse(codeImprovedMaterial);
  if (
    componentFallbackCount > 0 ||
    repairedCodeBlockCount > 0 ||
    codeFallbackCount > 0
  ) {
    await patchActiveLlmRecoveryMetadata({
      fallbackCount: componentFallbackCount + codeFallbackCount,
      repairedCodeBlockCount,
      codeFallbackCount,
      issueCategories: ["domain_invariant"],
    });
  }
  await options.onMaterialUpdate?.({
    material,
    completeBlockCount: material.blocks.length,
    placeholderBlockCount: 0,
  });
  return { items, material };
}
