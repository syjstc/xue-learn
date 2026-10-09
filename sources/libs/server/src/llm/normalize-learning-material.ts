import { readMaterialMusic } from "../../../domain/src/material-music.js";
import { readMusicTeaching } from "../../../domain/src/material-music-teaching.js";
import { readMaterialVisual } from "../../../domain/src/material-visual.js";
import { readMaterialTeaching } from "../../../domain/src/material-teaching.js";
import { isMaterialPresentation } from "../../../domain/src/material-presentation.js";
import { guidedImageDisplaySchema } from "../learning-systems/capabilities/material-components/guided-image/schema.js";
import { repairCollapsedMarkdownTables } from "../../../common/src/index.js";
import {
  normalizeChemistryLabDefinition,
  normalizeCircuitSandboxPayload,
  resolveCodeBoardSource,
  sanitizeCodeRegions,
  sanitizeParagraphCue,
  isForbiddenStageFigureType,
  isMaterialStageLayout,
  precedingDisplayIndex,
  resolveParagraphCue,
  blockFigureId,
  type ChemistryStage,
} from "../../../domain/src/index.js";
import { repairBareMarkdownCodeFences } from "../markdown/repair-code-fences.js";
import type { InteractiveBlock } from "./schemas.js";
import { expandLearningMaterialCompact } from "./compact-json.js";
import { splitSpokenSentencePieces } from "./narrated-material-sequence.js";
import { normalizeGeneratedCourseSvg } from "./safe-svg.js";

/** Must match `learningMaterialSchema` in schemas.ts */
export const MAX_KEY_TAKEAWAYS = 10;
export const MIN_LEARNING_MATERIAL_BLOCKS = 6;
export const MIN_KEY_TAKEAWAYS = 0;

type LegacySection = {
  title?: string;
  content?: string;
  examples?: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalFigureId(
  raw: Record<string, unknown>,
): { id?: string } {
  const id = asString(raw.id);
  return id ? { id } : {};
}

/** Markdown-bearing lesson strings (paragraph/callout/accordion bodies, etc.). */
function asMarkdownString(value: unknown): string {
  const text = asString(value);
  if (!text) return "";
  return repairBareMarkdownCodeFences(repairCollapsedMarkdownTables(text));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizedKeyPointText(text: string): string {
  return text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function uniqueKeyPointTexts(points: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const point of points) {
    const trimmed = point.trim();
    if (!trimmed) continue;
    const key = normalizedKeyPointText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

const MARKDOWN_LIST_ITEM = /^(?:[-*+•▪◦]\s+|\d+[.)、]\s*)(.+)$/;

function markdownListItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(MARKDOWN_LIST_ITEM);
      return match?.[1]?.trim() ? [match[1].trim()] : [];
    });
}

function paragraphListItems(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const listItems = markdownListItems(text);
  return listItems.length >= 2 && listItems.length / lines.length >= 0.6
    ? listItems
    : [];
}

function coversKeyPoints(
  existing: readonly string[],
  takeaways: readonly string[],
): boolean {
  if (existing.length === 0 || takeaways.length === 0) return false;
  const known = new Set(existing.map(normalizedKeyPointText));
  return takeaways.every((item) => known.has(normalizedKeyPointText(item)));
}

function uniqueParagraphListItems(text: string): string {
  const items = paragraphListItems(text);
  if (items.length < 2) return text;
  const unique = uniqueKeyPointTexts(items);
  if (unique.length === items.length) return text;
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => MARKDOWN_LIST_ITEM.test(line));
  const prefix = firstLine?.match(/^(?:[-*+•▪◦]\s+|\d+[.)、]\s*)/)?.[0] ?? "- ";
  return unique.map((item) => `${prefix}${item}`).join("\n");
}

function isStandaloneIntegerOption(option: string): boolean {
  return /^\d+$/.test(option.trim());
}

function hasOptionLabel(option: string): boolean {
  return /^[A-Z][.)、．]\s*/i.test(option.trim());
}

function normalizeCheckOptions(value: unknown): string[] {
  const options = asStringArray(value);
  const textOptionCount = options.filter(
    (option) => !isStandaloneIntegerOption(option),
  ).length;
  const hasLabeledTextOptions = options.some(
    (option) => !isStandaloneIntegerOption(option) && hasOptionLabel(option),
  );
  if (textOptionCount < 2 || (options.length <= 3 && !hasLabeledTextOptions)) {
    return options;
  }
  return options.filter((option) => !isStandaloneIntegerOption(option));
}

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value) ?? {};
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, item]) => [key, asString(item)] as const)
      .filter(([, item]) => Boolean(item)),
  );
}

/** Schema allows only h2/h3; LLMs often emit 1, 4, or string levels. */
function normalizeHeadingLevel(raw: unknown): 2 | 3 {
  const n = asInt(raw, 2);
  return n >= 3 ? 3 : 2;
}

function normalizeBlockType(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/-/g, "_");
  const aliases: Record<string, string> = {
    headline: "heading",
    h2: "heading",
    h3: "heading",
    section_heading: "heading",
    text: "paragraph",
    p: "paragraph",
    code_block: "code",
    codeblock: "code",
    snippet: "code",
    dialogue: "conversation",
    dialog: "conversation",
    transcript: "conversation",
    quiz: "check",
    mcq: "check",
    comparison: "compare",
    vs: "compare",
    stage: "stage",
    board: "stage",
    svg_slot: "svg_slot",
    image: "illustration",
    illustration: "illustration",
    figure: "illustration",
    diagram: "illustration",
    loading: "placeholder",
    pending: "placeholder",
    steps_sort: "step_sort",
    sort_steps: "step_sort",
    step_order: "step_sort",
  };
  return aliases[t] ?? t;
}

function normalizeSequenceItems(
  value: unknown,
): Array<{ id: string; content: string; order: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const id = asString(rec.id ?? rec.key ?? `step_${index + 1}`);
      const content = asString(
        rec.content ?? rec.text ?? rec.label ?? rec.description ?? rec.body,
      );
      if (!id || !content) return null;
      const order =
        rec.order != null
          ? asInt(rec.order, index + 1)
          : rec.position != null
            ? asInt(rec.position, index + 1)
            : index + 1;
      return { id, content, order };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeStepSortBlock(
  b: Record<string, unknown>,
): InteractiveBlock | null {
  const title = asString(b.title);
  const rawSequence =
    b.correct_sequence ?? b.correctSequence ?? b.steps ?? b.sequence;
  const items = normalizeSequenceItems(rawSequence);
  if (!title || items.length < 2) return null;

  const sorted = [...items].sort((a, b) => a.order - b.order);
  const correct_sequence = sorted.map((item, index) => ({
    id: item.id,
    content: item.content,
    order: index + 1,
  }));
  const dependency_hint = asString(
    b.dependency_hint ?? b.dependencyHint ?? b.hint,
  );
  return { type: "step_sort", title, correct_sequence, dependency_hint };
}

function normalizeCalloutVariant(
  raw: unknown,
): "tip" | "warning" | "definition" | "example" {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "tip" || v === "hint" || v === "note") return "tip";
  if (v === "warning" || v === "warn" || v === "caution") return "warning";
  if (v === "definition" || v === "def" || v === "concept") return "definition";
  return "example";
}

function normalizeCompareSide(value: unknown, fallbackId?: string) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return { label: "对照", points: [] as string[] };
    return {
      ...(fallbackId ? { id: fallbackId } : {}),
      label: text.slice(0, 32),
      points: [text],
    };
  }
  const side = asRecord(value) ?? {};
  const points = asStringArray(side.points ?? side.items ?? side.bullets);
  const label = asString(side.label) || "方案";
  const id = asString(side.id) || fallbackId || "";
  const withId = id ? { id } : {};
  if (points.length > 0) return { ...withId, label, points };
  const body = asString(side.text ?? side.body ?? side.content);
  return { ...withId, label, points: body ? [body] : [] };
}

function normalizeBlock(item: unknown): InteractiveBlock | null {
  const b = asRecord(item);
  if (!b) return null;

  const type = normalizeBlockType(b.type ?? b.component_type);
  if (!type) return null;

  if (type === "heading") {
    const text = asString(b.text ?? b.title ?? b.content);
    if (!text) return null;
    const topicId = asString(b.topicId ?? b.topic_id);
    return {
      type: "heading",
      level: normalizeHeadingLevel(
        b.level ?? b.headingLevel ?? b.heading_level,
      ),
      text,
      ...(topicId ? { topicId } : {}),
    };
  }

  if (type === "paragraph") {
    const text = uniqueParagraphListItems(
      asMarkdownString(b.text ?? b.body ?? b.content),
    );
    if (!text) return null;
    const cue = sanitizeParagraphCue(b.cue);
    return { type: "paragraph", text, ...(cue ? { cue: { ...cue, ...(cue.targetIds ? { targetIds: [...cue.targetIds] } : {}), ...(cue.regionIds ? { regionIds: [...cue.regionIds] } : {}) } } : {}) };
  }

  if (type === "code") {
    const source = resolveCodeBoardSource(
      asString(b.code ?? b.text ?? b.content ?? b.body),
      b.parts ?? b.segments ?? b.chunks,
    );
    if (!source) return null;
    const language = asString(b.language ?? b.lang);
    const regions = source.parts?.length
      ? undefined
      : sanitizeCodeRegions(source.code, b.regions);
    return {
      type: "code",
      ...optionalFigureId(b),
      code: source.code,
      ...(language ? { language } : {}),
      ...(source.parts ? { parts: source.parts } : {}),
      ...(regions ? { regions } : {}),
    };
  }

  if (type === "conversation") {
    const title = asString(b.title ?? b.scene ?? b.context);
    const rawTurns = Array.isArray(b.turns)
      ? b.turns
      : Array.isArray(b.messages)
        ? b.messages
        : [];
    const turns = rawTurns
      .map((item) => {
        const turn = asRecord(item);
        if (!turn) return null;
        const speaker = asString(
          turn.speaker ?? turn.name ?? turn.role ?? turn.label,
        );
        const text = asMarkdownString(
          turn.text ?? turn.content ?? turn.message ?? turn.body,
        );
        return speaker && text ? { speaker, text } : null;
      })
      .filter(
        (turn): turn is { speaker: string; text: string } => turn !== null,
      );
    if (turns.length < 2) return null;
    return {
      type: "conversation",
      ...optionalFigureId(b),
      ...(title ? { title } : {}),
      turns,
    };
  }

  if (type === "music") return readMusicTeaching(b) ?? readMaterialMusic(b);
  if (type === "visual") return readMaterialVisual(b);
  if (type === "teaching") return readMaterialTeaching(b);

  if (type === "callout") {
    const body = asMarkdownString(b.body ?? b.content ?? b.text);
    if (!body) return null;
    const title = asString(b.title);
    return {
      type: "callout",
      ...optionalFigureId(b),
      variant: normalizeCalloutVariant(b.variant ?? b.kind ?? b.style),
      ...(title ? { title } : {}),
      body,
    };
  }

  if (type === "accordion") {
    const title = asString(b.title ?? b.heading);
    const body = asMarkdownString(b.body ?? b.content);
    if (!title || !body) return null;
    return { type: "accordion", ...optionalFigureId(b), title, body };
  }

  if (type === "check") {
    const question = asString(b.question ?? b.prompt);
    const options = normalizeCheckOptions(b.options ?? b.choices);
    const explanation =
      asString(b.explanation ?? b.rationale) || "请参考上文内容。";
    const learningTargetIds = asStringArray(
      b.learningTargetIds ?? b.learning_target_ids,
    ).filter((id) => /^lt_\d+$/i.test(id));
    if (learningTargetIds.length === 0) return null;
    const normalizedTargetIds = learningTargetIds.map((id) => id.toLowerCase());
    const checkId = asString(b.checkId ?? b.check_id);
    const primaryLearningTargetId = asString(
      b.primaryLearningTargetId ?? b.primary_learning_target_id,
    ).toLowerCase();
    const targetCognitiveEntityId = asString(
      b.targetCognitiveEntityId ?? b.target_cognitive_entity_id,
    );
    const rawDimension = asString(b.evidenceDimension ?? b.evidence_dimension);
    const evidenceDimension = [
      "memory",
      "understanding",
      "application",
    ].includes(rawDimension)
      ? (rawDimension as "memory" | "understanding" | "application")
      : "understanding";
    const criterionRef =
      asString(b.criterionRef ?? b.criterion_ref) ||
      `${normalizedTargetIds[0]}:c1`;
    const rawContextDistance = asString(
      b.contextDistance ?? b.context_distance,
    );
    const contextDistance = rawContextDistance === "near" ? "near" : "same";
    const shared = {
      type: "check" as const,
      ...(checkId ? { checkId } : {}),
      question,
      explanation,
      ...(primaryLearningTargetId && /^lt_\d+$/.test(primaryLearningTargetId)
        ? { primaryLearningTargetId }
        : {}),
      learningTargetIds: normalizedTargetIds,
      ...(targetCognitiveEntityId ? { targetCognitiveEntityId } : {}),
      evidenceDimension,
      criterionRef,
      contextDistance,
    };

    const rawQuestionType = asString(b.questionType ?? b.question_type);
    const rawCorrectIndices = Array.isArray(b.correctIndices)
      ? b.correctIndices
      : Array.isArray(b.correct_indices)
        ? b.correct_indices
        : null;
    const correctIndices = (rawCorrectIndices ?? [])
      .map((item) => asInt(item, -1))
      .filter(
        (index, position, all) => index >= 0 && all.indexOf(index) === position,
      );
    const hasBooleanAnswer =
      typeof (b.correctAnswer ?? b.correct_answer) === "boolean";
    const questionType =
      rawQuestionType === "true_false" ||
      rawQuestionType === "mcq_multi" ||
      rawQuestionType === "mcq"
        ? rawQuestionType === "mcq" && correctIndices.length >= 2
          ? "mcq_multi"
          : rawQuestionType
        : hasBooleanAnswer
          ? "true_false"
          : correctIndices.length >= 2
            ? "mcq_multi"
            : "mcq";

    if (questionType === "true_false") {
      return {
        ...shared,
        questionType,
        correctAnswer: Boolean(b.correctAnswer ?? b.correct_answer),
      };
    }

    if (!question || options.length < 2) return null;

    if (questionType === "mcq_multi") {
      const boundedIndices = correctIndices.filter(
        (index) => index < options.length,
      );
      if (boundedIndices.length < 2) return null;
      return {
        ...shared,
        questionType,
        options,
        correctIndices: boundedIndices,
      };
    }

    const rawIndex = b.correctIndex ?? b.correct_index ?? b.answer ?? 0;
    const index = asInt(rawIndex, 0);
    const correctIndex = Math.min(Math.max(0, index), options.length - 1);
    return {
      ...shared,
      questionType,
      options,
      correctIndex,
    };
  }

  if (type === "steps" || type === "step_list" || type === "step") {
    const rawItems = (
      Array.isArray(b.items ?? b.it) ? (b.items ?? b.it) : []
    ) as unknown[];
    const items = rawItems
      .map((entry: unknown) => {
        const step = asRecord(entry);
        if (!step) return null;
        const title = asString(step.title ?? step.name ?? step.ti);
        const detail = asString(
          step.detail ?? step.body ?? step.content ?? step.dt,
        );
        if (!title && !detail) return null;
        if (title && detail) return `${title}：${detail}`;
        return title || detail;
      })
      .filter((line): line is string => Boolean(line));
    if (items.length === 0) return null;
    return {
      type: "callout",
      variant: "example",
      title: "步骤",
      body: items.map((line, index) => `${index + 1}. ${line}`).join("\n"),
    };
  }

  if (type === "compare") {
    const left = normalizeCompareSide(b.left ?? b.a, "left");
    const right = normalizeCompareSide(b.right ?? b.b, "right");
    if (left.points.length === 0 || right.points.length === 0) return null;
    const block = { type: "compare" as const, ...optionalFigureId(b), left, right };
    const sidesRaw = Array.isArray(b.sides) ? b.sides : null;
    if (sidesRaw) {
      const sides = sidesRaw
        .map((side, index) =>
          normalizeCompareSide(
            side,
            index === 0 ? "left" : index === 1 ? "right" : `side-${index}`,
          ),
        )
        .filter((side) => side.points.length > 0);
      if (sides.length >= 2) {
        return {
          ...block,
          left: sides[0]!,
          right: sides[1]!,
          sides,
        };
      }
    }
    return block;
  }

  if (
    type === "cause_effect_link" ||
    type === "process_fill" ||
    type === "timeline_build" ||
    type === "state_transition" ||
    type === "solution_design" ||
    type === "true_false" ||
    type === "flip_card" ||
    type === "param_simulator" ||
    type === "branch_scenario" ||
    type === "animated_svg"
  ) {
    return null;
  }

  if (type === "step_sort") {
    return normalizeStepSortBlock(b);
  }

  if (type === "circuit_sandbox") {
    return normalizeCircuitSandboxPayload({ ...b, type }) as InteractiveBlock;
  }

  if (type === "chemistry_lab") {
    const normalized = normalizeChemistryLabDefinition({
      experimentId: asString(b.experimentId),
      experimentVersion:
        typeof b.experimentVersion === "number" ? b.experimentVersion : 1,
      title: asString(b.title),
      summary: asString(b.summary),
      stage:
        typeof b.stage === "string" ? (b.stage as ChemistryStage) : undefined,
      targetObservation: asString(b.targetObservation),
      parameters: asRecord(b.parameters) as Record<string, number> | undefined,
      strictParameters: true,
    });
    return normalized as unknown as InteractiveBlock | null;
  }

  if (type === "graph") {
    const variant = asString(b.variant);
    if (variant !== "process_flow" && variant !== "concept_map") return null;
    return { ...b, type, variant } as unknown as InteractiveBlock;
  }

  if (
    type === "chart" ||
    type === "math_scene" ||
    type === "interactive_html" ||
    type === "mechanics_sandbox"
  ) {
    // These components are already declarative JSON and are validated by
    // interactiveBlockSchema after normalization.
    return { ...b, type } as unknown as InteractiveBlock;
  }

  if (type === "svg") {
    const title = asString(b.title);
    const caption = asString(b.caption);
    const alt = asString(b.alt);
    const rawSvg = typeof b.svg === "string" ? b.svg.trim() : "";
    if (!caption || !alt || !rawSvg) return null;
    const svg = normalizeGeneratedCourseSvg(rawSvg);
    return {
      type: "svg",
      ...optionalFigureId(b),
      ...(title ? { title } : {}),
      caption,
      alt,
      svg,
    };
  }

  if (type === "illustration") {
    const caption = asString(b.caption ?? b.title ?? b.alt);
    const prompt = asString(
      b.prompt ?? b.imagePrompt ?? b.image_prompt ?? b.description,
    );
    if (!caption || !prompt) return null;
    const styleRaw = asString(b.style ?? b.kind).toLowerCase();
    const style =
      styleRaw === "process" ||
      styleRaw === "concept" ||
      styleRaw === "comparison"
        ? styleRaw
        : "diagram";
    const ar = asString(b.aspectRatio ?? b.aspect_ratio);
    const validRatios = new Set([
      "1:1",
      "16:9",
      "4:3",
      "3:2",
      "2:3",
      "3:4",
      "9:16",
    ]);
    const aspectRatio = validRatios.has(ar)
      ? (ar as "1:1" | "16:9" | "4:3" | "3:2" | "2:3" | "3:4" | "9:16")
      : undefined;
    const imageId = asString(b.imageId ?? b.image_id) || undefined;
    const imageUrl = asString(b.imageUrl ?? b.image_url ?? b.url) || undefined;
    return {
      type: "illustration",
      ...optionalFigureId(b),
      caption,
      prompt,
      style,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(imageId ? { imageId } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(b.guidedImage ? { guidedImage: guidedImageDisplaySchema.parse(b.guidedImage) } : {}),
    };
  }

  if (type === "svg_slot") {
    const intent = asRecord(b.intent);
    if (!intent) return null;
    return { type: "svg_slot", ...optionalFigureId(b), intent } as InteractiveBlock;
  }

  if (type === "stage") {
    const layoutRaw = asString(b.layout);
    const layout = isMaterialStageLayout(layoutRaw) ? layoutRaw : "split-h";
    const rawFigures = Array.isArray(b.figures) ? b.figures : [];
    const figures = rawFigures
      .map((item) => normalizeBlock(item))
      .filter((block): block is InteractiveBlock => Boolean(block))
      .filter((block) => !isForbiddenStageFigureType(block.type));
    if (figures.length === 1) return figures[0]!;
    if (figures.length < 2) return null;
    return {
      type: "stage",
      ...optionalFigureId(b),
      layout,
      ...(isMaterialPresentation(b.presentation) ? { presentation: b.presentation } : {}),
      figures: figures.slice(0, 4),
    } as InteractiveBlock;
  }

  if (type === "placeholder") {
    const reason = asString(b.reason) || "这个互动部分正在完善，请稍候…";
    const componentTypes = new Set([
      "check",
      "step_sort",
      "graph",
      "chart",
      "math_scene",
      "svg",
      "interactive_html",
      "mechanics_sandbox",
      "circuit_sandbox",
      "chemistry_lab",
    ]);
    const componentType = asString(b.componentType);
    const description = asString(b.description);
    const primaryLearningTargetId = asString(b.primaryLearningTargetId);
    const targetCognitiveEntityId = asString(b.targetCognitiveEntityId);
    const evidenceDimension = asString(b.evidenceDimension);
    const criterionRef = asString(b.criterionRef);
    const contextDistance = asString(b.contextDistance);
    return {
      type: "placeholder",
      reason,
      ...(componentTypes.has(componentType)
        ? {
            componentType: componentType as Extract<
              InteractiveBlock,
              { type: "placeholder" }
            >["componentType"],
          }
        : {}),
      ...(description ? { description } : {}),
      ...(primaryLearningTargetId ? { primaryLearningTargetId } : {}),
      ...(targetCognitiveEntityId ? { targetCognitiveEntityId } : {}),
      ...(evidenceDimension === "memory" ||
      evidenceDimension === "understanding"
        ? { evidenceDimension }
        : {}),
      ...(criterionRef ? { criterionRef } : {}),
      ...(contextDistance === "same" ? { contextDistance } : {}),
    };
  }

  return null;
}

function fillDefaultParagraphCues(
  blocks: InteractiveBlock[],
): InteractiveBlock[] {
  return blocks.map((block, index) => {
    if (block.type !== "paragraph") return block;
    if ("cue" in block && block.cue) return block;
    if (precedingDisplayIndex(blocks, index) == null) return block;
    const displayIndex = precedingDisplayIndex(blocks, index);
    const display = displayIndex == null ? undefined : blocks[displayIndex];
    const stageFigures =
      display?.type === "stage"
        ? (display as { figures?: readonly { id?: unknown }[] }).figures
        : undefined;
    const figureId =
      blockFigureId(display) || blockFigureId(stageFigures?.[0]);
    return {
      ...block,
      cue: {
        target: "whole",
        ...(figureId ? { figureId, targetIds: [figureId] } : { targetIds: ["whole"] }),
      },
    };
  });
}

function stripUnresolvedParagraphCues(
  blocks: InteractiveBlock[],
): InteractiveBlock[] {
  return blocks.map((block, index) => {
    if (block.type !== "paragraph" || !("cue" in block) || !block.cue) {
      return block;
    }
    const displayIndex = precedingDisplayIndex(blocks, index);
    const display = displayIndex == null ? null : blocks[displayIndex];
    if (resolveParagraphCue(display, block.cue)) return block;
    const { cue: _dropped, ...rest } = block;
    return rest as InteractiveBlock;
  });
}

function normalizeBlocks(value: unknown): InteractiveBlock[] {
  if (!Array.isArray(value)) return [];
  return stripUnresolvedParagraphCues(
    fillDefaultParagraphCues(
      value
        .map((item) => normalizeBlock(item))
        .filter((block): block is InteractiveBlock => block !== null),
    ),
  );
}

function legacySectionsToBlocks(sections: LegacySection[]): InteractiveBlock[] {
  const blocks: InteractiveBlock[] = [];
  for (const sec of sections) {
    if (sec.title?.trim()) {
      blocks.push({ type: "heading", level: 2, text: sec.title.trim() });
    }
    if (sec.content?.trim()) {
      blocks.push({
        type: "paragraph",
        text: repairCollapsedMarkdownTables(sec.content.trim()),
      });
    }
    if (sec.examples?.length) {
      blocks.push({
        type: "callout",
        variant: "example",
        title: "示例",
        body: sec.examples.map((ex, i) => `${i + 1}. ${ex}`).join("\n"),
      });
    }
  }
  return blocks;
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => splitSpokenSentencePieces(line))
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

function sectionTakeawayListParagraph(items: string[]): InteractiveBlock {
  return {
    type: "paragraph",
    text: items.map((item) => `- ${item}`).join("\n"),
  };
}

function migrateKeyTakeawaysToBlocks(material: {
  introduction: string;
  blocks: InteractiveBlock[];
  keyTakeaways: string[];
}) {
  const takeaways = uniqueKeyPointTexts(material.keyTakeaways);
  if (takeaways.length === 0) {
    return { ...material, keyTakeaways: [] as string[] };
  }
  const last = material.blocks.at(-1);
  if (
    last?.type === "paragraph" &&
    coversKeyPoints(uniqueKeyPointTexts(markdownListItems(last.text)), takeaways)
  ) {
    return { ...material, keyTakeaways: [] as string[] };
  }
  return {
    ...material,
    blocks: [...material.blocks, sectionTakeawayListParagraph(takeaways)],
    keyTakeaways: [] as string[],
  };
}

const PADDING_TIP_TITLE = "学习提示";
const PADDING_TIP_BODY = "请结合上文互动内容完成本单元学习。";

const PADDING_PARAGRAPHS = [
  "阅读正文内容，理清概念定义与适用场景。",
  "对照要点，确认自己能否独立回答引导问题。",
  "回顾易混淆点：能区分相似概念并说出判断依据。",
  "完成本单元后，尝试用一句话概括你最核心的收获。",
  "将本节要点与学习目标对照，标记仍不清楚的部分。",
  "用具体例子检验自己是否真正理解，而非只会复述原文。",
  "注意文中对比、步骤与示例之间的逻辑关系。",
  "学习结束前，再快速浏览一遍核心定义与结论。",
];

function isPaddingTipCallout(block: InteractiveBlock): boolean {
  return (
    block.type === "callout" &&
    block.variant === "tip" &&
    block.title === PADDING_TIP_TITLE &&
    block.body === PADDING_TIP_BODY
  );
}

/**
 * Remove exact duplicate authored blocks while keeping assessment blocks
 * addressable. A repeated question is not safe to collapse because its
 * checkId/task state is owned by the assessment system; prose and generated
 * visual blocks, however, are immutable-value content and can be safely
 * de-duplicated at every persisted/read boundary.
 */
export function dedupeExactMaterialBlocks(
  blocks: readonly InteractiveBlock[],
): InteractiveBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (block.type === "check") return true;
    const fingerprint = JSON.stringify(block);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

/** Strip old schema-padding tips from stored or freshly normalized material. */
function stripPaddingTipCallouts(
  blocks: InteractiveBlock[],
): InteractiveBlock[] {
  return blocks.filter((block) => !isPaddingTipCallout(block));
}

function ensureMinBlocks(
  blocks: InteractiveBlock[],
  introduction: string,
): InteractiveBlock[] {
  const result = stripPaddingTipCallouts(blocks);
  if (result.length >= MIN_LEARNING_MATERIAL_BLOCKS) {
    return result;
  }

  for (const sentence of splitSentences(introduction)) {
    if (result.length >= MIN_LEARNING_MATERIAL_BLOCKS) break;
    if (
      result.some(
        (block) => block.type === "paragraph" && block.text === sentence,
      )
    ) {
      continue;
    }
    result.push({ type: "paragraph", text: sentence });
  }

  let fallbackIndex = 0;
  while (result.length < MIN_LEARNING_MATERIAL_BLOCKS) {
    const text = PADDING_PARAGRAPHS[fallbackIndex % PADDING_PARAGRAPHS.length]!;
    fallbackIndex += 1;
    result.push({ type: "paragraph", text });
  }

  return result;
}

function finalizeLearningMaterial(material: {
  introduction: string;
  blocks: InteractiveBlock[];
  keyTakeaways: string[];
}) {
  const introduction = material.introduction.trim() || "本单元学习材料。";
  const blocks = ensureMinBlocks(material.blocks, introduction);
  return migrateKeyTakeawaysToBlocks({
    introduction,
    blocks,
    keyTakeaways: material.keyTakeaways,
  });
}

/** Coerce one interactive block from LLM/DSL JSON before schema validation. */
export function normalizeInteractiveBlock(
  item: unknown,
): InteractiveBlock | null {
  return normalizeBlock(item);
}

/** Accept new `blocks` or legacy textbook `sections`; coerce LLM block quirks. */
export function normalizeLearningMaterial(input: unknown): unknown {
  const expanded = expandLearningMaterialCompact(input);
  if (!expanded || typeof expanded !== "object") return expanded;
  const obj = expanded as Record<string, unknown>;

  if (
    obj.introduction == null &&
    obj.blocks == null &&
    obj.sections == null &&
    typeof obj.structured_response === "object" &&
    obj.structured_response != null
  ) {
    return normalizeLearningMaterial(obj.structured_response);
  }

  const singleKey = Object.keys(obj);
  if (
    singleKey.length === 1 &&
    obj.introduction == null &&
    obj.blocks == null &&
    obj.sections == null
  ) {
    const inner = obj[singleKey[0]!];
    if (inner && typeof inner === "object") {
      return normalizeLearningMaterial(inner);
    }
  }

  if (Array.isArray(obj.blocks)) {
    return finalizeLearningMaterial({
      introduction: asMarkdownString(obj.introduction),
      blocks: normalizeBlocks(obj.blocks),
      keyTakeaways: asStringArray(obj.keyTakeaways ?? obj.key_takeaways),
    });
  }

  if (Array.isArray(obj.sections) && obj.sections.length > 0) {
    return finalizeLearningMaterial({
      introduction: asMarkdownString(obj.introduction),
      blocks: legacySectionsToBlocks(obj.sections as LegacySection[]),
      keyTakeaways: asStringArray(obj.keyTakeaways ?? obj.key_takeaways),
    });
  }

  return input;
}
