import type {
  InteractiveBlock,
  LearningMaterialContent,
} from "@xue-learn/core/schemas";

export type AssistantCourseFeedBlock = {
  block: InteractiveBlock;
  blockIndex: number;
};

export type AssistantCourseFeedTurn =
  | {
      kind: "lesson";
      narration: Array<
        | { kind: "introduction"; text: string }
        | { kind: "paragraph"; text: string; blockIndex: number }
      >;
      dividers: AssistantCourseFeedBlock[];
    }
  | {
      kind: "display";
      display: AssistantCourseFeedBlock;
      dividers: AssistantCourseFeedBlock[];
    }
  | {
      kind: "summary";
      takeaways: string[];
      dividers: AssistantCourseFeedBlock[];
    }
  | {
      kind: "key_points";
      text: string;
      blockIndex: number;
      dividers: AssistantCourseFeedBlock[];
    };

export type AssistantCourseSceneBeat = {
  key: string;
  kind: "explanation" | "display" | "key_points" | "summary";
  title?: string;
  startTurnIndex: number;
  endTurnIndex: number;
};

export const ASSISTANT_COURSE_JIT_BUFFER_TURNS = 2;

export function hasAssistantCourseJitBuffer(
  visibleTurnCount: number,
  turnCount: number,
): boolean {
  return turnCount - visibleTurnCount >= ASSISTANT_COURSE_JIT_BUFFER_TURNS;
}

function isParagraphNarrationTurn(
  turn: AssistantCourseFeedTurn | undefined,
): turn is Extract<AssistantCourseFeedTurn, { kind: "lesson" }> {
  return (
    turn?.kind === "lesson" &&
    turn.narration.length > 0 &&
    turn.narration.every((item) => item.kind === "paragraph")
  );
}

/**
 * Paragraph turns stay independently paced and can auto-advance while remaining
 * distinct assistant messages. A heading before the current paragraph or a
 * concrete block after the previous paragraph starts a new pacing group.
 */
export function isAssistantCourseParagraphContinuation(
  turns: AssistantCourseFeedTurn[],
  turnIndex: number,
): boolean {
  const previous = turns[turnIndex - 1];
  const current = turns[turnIndex];
  return (
    isParagraphNarrationTurn(previous) &&
    isParagraphNarrationTurn(current) &&
    current.dividers.length === 0
  );
}

export function shouldAutoAdvanceAssistantCourseParagraph(
  turns: AssistantCourseFeedTurn[],
  turnIndex: number,
): boolean {
  return isAssistantCourseParagraphContinuation(turns, turnIndex + 1);
}

function lessonTurn(
  narration: Extract<AssistantCourseFeedTurn, { kind: "lesson" }>["narration"],
  dividers: AssistantCourseFeedBlock[],
): AssistantCourseFeedTurn {
  return {
    kind: "lesson",
    narration: [...narration],
    dividers: [...dividers],
  };
}

function paragraphListItems(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const listItems = lines.flatMap((line) => {
    const match = line.match(/^(?:[-*+•▪◦]\s+|\d+[.)、]\s*)(.+)$/);
    return match?.[1]?.trim() ? [match[1].trim()] : [];
  });
  return listItems.length >= 2 && listItems.length / lines.length >= 0.6
    ? listItems
    : [];
}

function normalizedKeyPoint(text: string): string {
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
    const key = normalizedKeyPoint(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function uniqueParagraphListItems(text: string): string {
  const items = paragraphListItems(text);
  if (items.length < 2) return text;
  const unique = uniqueKeyPointTexts(items);
  if (unique.length === items.length) return text;
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(?:[-*+•▪◦]\s+|\d+[.)、]\s*)/.test(line));
  const prefix = firstLine?.match(/^(?:[-*+•▪◦]\s+|\d+[.)、]\s*)/)?.[0] ?? "- ";
  return unique.map((item) => `${prefix}${item}`).join("\n");
}

function sameKeyPoints(left: string[], right: string[]): boolean {
  const uniqueLeft = uniqueKeyPointTexts(left);
  const uniqueRight = uniqueKeyPointTexts(right);
  return (
    uniqueLeft.length === uniqueRight.length &&
    uniqueLeft.every((item, index) => {
      const other = uniqueRight[index] ?? "";
      return normalizedKeyPoint(item) === normalizedKeyPoint(other);
    })
  );
}

function isKeyPointsTransitionHeading(block: InteractiveBlock): boolean {
  if (block.type !== "heading") return false;
  const text = block.text.trim();
  return (
    /(?:重点|要点|小结|总结|回顾|收一下|收个尾|记住这些)/u.test(text) ||
    /(?:key\s*points?|takeaways?|summary|recap)/iu.test(text)
  );
}

/**
 * Convert the canonical material envelope into learner-paced feed turns.
 *
 * Each introduction or paragraph is its own assistant message. Consecutive
 * paragraphs remain separate turns for sequential typewriter playback and may
 * auto-advance without hiding the assistant identity. Every
 * concrete block is a separate learner-paced display turn, so a paragraph before
 * it acts as the teacher's setup and a paragraph after it acts as interpretation.
 * Heading blocks are lightweight dividers attached to the next meaningful item.
 */
export function buildAssistantCourseFeed(
  material: LearningMaterialContent,
): AssistantCourseFeedTurn[] {
  const turns: AssistantCourseFeedTurn[] = [];
  let pendingDividers: AssistantCourseFeedBlock[] = [];
  let pendingKeyPointsDividers: AssistantCourseFeedBlock[] = [];
  let narration:
    | Extract<AssistantCourseFeedTurn, { kind: "lesson" }>["narration"][number]
    | null = null;
  let narrationDividers: AssistantCourseFeedBlock[] = [];

  const flushNarration = () => {
    if (!narration) return;
    turns.push(lessonTurn([narration], narrationDividers));
    narration = null;
    narrationDividers = [];
  };

  const beginNarration = (item: NonNullable<typeof narration>) => {
    flushNarration();
    narration = item;
    narrationDividers = pendingDividers;
    pendingDividers = [];
  };

  const introduction = material.introduction.trim();
  if (introduction) {
    beginNarration({ kind: "introduction", text: introduction });
  }

  material.blocks.forEach((block, blockIndex) => {
    if (block.type === "paragraph") {
      const keyPoints = uniqueKeyPointTexts(paragraphListItems(block.text));
      if (keyPoints.length > 0) {
        flushNarration();
        const alreadyShown = turns.some(
          (turn) =>
            turn.kind === "key_points" &&
            sameKeyPoints(paragraphListItems(turn.text), keyPoints),
        );
        if (alreadyShown) {
          pendingKeyPointsDividers = [];
          pendingDividers = [];
          return;
        }
        turns.push({
          kind: "key_points",
          text: uniqueParagraphListItems(block.text),
          blockIndex,
          dividers: [...pendingKeyPointsDividers, ...pendingDividers],
        });
        pendingKeyPointsDividers = [];
        pendingDividers = [];
        return;
      }
      beginNarration({ kind: "paragraph", text: block.text, blockIndex });
      return;
    }

    if (block.type === "heading") {
      if (isKeyPointsTransitionHeading(block)) {
        pendingKeyPointsDividers.push({ block, blockIndex });
      } else {
        pendingDividers.push({ block, blockIndex });
      }
      return;
    }

    const component = { block, blockIndex };
    flushNarration();
    turns.push({
      kind: "display",
      display: component,
      dividers: pendingDividers,
    });
    pendingDividers = [];
  });

  if (narration) {
    flushNarration();
  }
  if (pendingDividers.length > 0) {
    turns.push(lessonTurn([], pendingDividers));
    pendingDividers = [];
  }

  const takeaways = uniqueKeyPointTexts(
    material.keyTakeaways.map((item) => item.trim()).filter(Boolean),
  );
  const hasEquivalentKeyPointsTurn = turns.some(
    (turn) =>
      turn.kind === "key_points" &&
      sameKeyPoints(
        uniqueKeyPointTexts(paragraphListItems(turn.text)),
        takeaways,
      ),
  );
  if (takeaways.length > 0 && !hasEquivalentKeyPointsTurn) {
    turns.push({
      kind: "summary",
      takeaways,
      dividers: pendingKeyPointsDividers,
    });
    pendingKeyPointsDividers = [];
  }
  if (pendingKeyPointsDividers.length > 0) {
    turns.push(lessonTurn([], pendingKeyPointsDividers));
  }

  return turns;
}

function narrationContentKey(
  turn: Extract<AssistantCourseFeedTurn, { kind: "lesson" }>,
): string | null {
  const first = turn.narration[0];
  if (!first) {
    return turn.dividers[0] ? `heading:${turn.dividers[0].blockIndex}` : null;
  }
  return first.kind === "introduction"
    ? "intro"
    : `paragraph:${first.blockIndex}`;
}

function sceneHeading(
  turn: AssistantCourseFeedTurn,
): { key: string; title: string; blockIndex: number } | null {
  const heading = turn.dividers.find((entry) => entry.block.type === "heading");
  return heading?.block.type === "heading"
    ? {
        key: `heading:${heading.blockIndex}`,
        title: heading.block.text.trim(),
        blockIndex: heading.blockIndex,
      }
    : null;
}

export function sceneTopicBlockIndex(
  turns: readonly AssistantCourseFeedTurn[],
  beat:
    | Pick<AssistantCourseSceneBeat, "startTurnIndex" | "endTurnIndex">
    | undefined,
): number | null {
  if (!beat) return null;
  for (let index = beat.startTurnIndex; index < beat.endTurnIndex; index += 1) {
    const heading = sceneHeading(turns[index]!);
    if (heading) return heading.blockIndex;
  }
  for (let index = beat.startTurnIndex - 1; index >= 0; index -= 1) {
    const heading = sceneHeading(turns[index]!);
    if (heading) return heading.blockIndex;
  }
  return null;
}

function openingSceneKey(turn: AssistantCourseFeedTurn): string {
  if (turn.kind === "lesson") {
    return narrationContentKey(turn) ?? "opening";
  }
  if (turn.kind === "display") return `display:${turn.display.blockIndex}`;
  if (turn.kind === "key_points") return `key-points:${turn.blockIndex}`;
  return "summary";
}

/**
 * Headings define game-like part scenes inside a persisted teaching section.
 * Every turn under that heading—including prose, displays, key points, and
 * summary content—stays in the same scene until the next heading begins.
 */
export function buildAssistantCourseSceneBeats(
  turns: AssistantCourseFeedTurn[],
): AssistantCourseSceneBeat[] {
  const firstTurn = turns[0];
  if (!firstTurn) return [];

  const starts = turns.reduce<
    Array<{ index: number; key: string; title?: string }>
  >((result, turn, index) => {
    const heading = sceneHeading(turn);
    if (index === 0) {
      result.push({
        index,
        key: heading?.key ?? `opening:${openingSceneKey(turn)}`,
        title: heading?.title,
      });
    } else if (heading) {
      result.push({ index, key: heading.key, title: heading.title });
    }
    return result;
  }, []);

  return starts.map((start, index) => ({
    key: `part:${start.key}`,
    kind: "explanation",
    title: start.title,
    startTurnIndex: start.index,
    endTurnIndex: starts[index + 1]?.index ?? turns.length,
  }));
}

export function assistantCourseBeatIndexForCursor(
  beats: AssistantCourseSceneBeat[],
  cursor: number,
): number {
  if (beats.length === 0) return 0;
  const turnIndex = Math.max(0, Math.floor(cursor) - 1);
  const containing = beats.findIndex(
    (beat) => turnIndex >= beat.startTurnIndex && turnIndex < beat.endTurnIndex,
  );
  return containing >= 0 ? containing : beats.length - 1;
}

export function monotonicAssistantCourseCursor(
  previous: number,
  next: number,
  turnCount: number,
): number {
  if (turnCount <= 0) return 0;
  return clampAssistantCourseCursor(Math.max(previous, next), turnCount);
}

/** Stable client revision for legacy material that predates contentRevision. */
export function assistantCourseClientContentRevision(
  material: LearningMaterialContent,
): number {
  const source = JSON.stringify(material);
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function clampAssistantCourseCursor(
  cursor: number,
  turnCount: number,
): number {
  if (turnCount <= 0) return 0;
  if (!Number.isFinite(cursor)) return 1;
  return Math.max(1, Math.min(Math.floor(cursor), turnCount));
}

export function assistantCourseCursorStorageKey(input: {
  userId: string;
  unitId: string;
  sectionId: string;
  contentRevision: number;
}): string {
  return [
    "xue-learn",
    "assistant-course",
    "v2",
    input.userId,
    input.unitId,
    input.sectionId,
    input.contentRevision,
  ].join(":");
}

/**
 * A short-lived cursor used only while a JIT draft is being published. Unlike
 * the durable cursor, it intentionally does not include contentRevision so a
 * remount between the final stream event and the persisted revision can keep
 * the learner at the same turn.
 */
export function assistantCourseCursorHandoffStorageKey(input: {
  userId: string;
  unitId: string;
  sectionId: string;
}): string {
  return [
    "xue-learn",
    "assistant-course",
    "handoff",
    "v1",
    input.userId,
    input.unitId,
    input.sectionId,
  ].join(":");
}

type AssistantCourseCursorHandoff = {
  cursor: number;
  beatKey?: string;
  beatTitle?: string;
  offsetInBeat?: number;
};

/** Preserve the currently presented part across a material revision/remount. */
export function createAssistantCourseCursorHandoff(
  beats: AssistantCourseSceneBeat[],
  activeBeatIndex: number,
  cursor: number,
): string {
  const beat = beats[activeBeatIndex];
  const value: AssistantCourseCursorHandoff = {
    cursor,
    ...(beat
      ? {
          beatKey: beat.key,
          beatTitle: beat.title,
          offsetInBeat: Math.max(1, cursor - beat.startTurnIndex),
        }
      : {}),
  };
  return JSON.stringify(value);
}

/**
 * Resolve a handoff against revised content. Prefer the same heading-delimited
 * part; fall back to the old numeric cursor for legacy handoffs or changed
 * headings.
 */
export function resolveAssistantCourseCursorHandoff(
  raw: string | null,
  beats: AssistantCourseSceneBeat[],
  turnCount: number,
): number {
  if (!raw) return clampAssistantCourseCursor(1, turnCount);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "number") {
      return clampAssistantCourseCursor(parsed, turnCount);
    }
    if (!parsed || typeof parsed !== "object") {
      return clampAssistantCourseCursor(Number(raw), turnCount);
    }
    const value = parsed as AssistantCourseCursorHandoff;
    const beat =
      (value.beatKey
        ? beats.find((item) => item.key === value.beatKey)
        : undefined) ??
      (value.beatTitle
        ? beats.find((item) => item.title === value.beatTitle)
        : undefined);
    if (beat) {
      return clampAssistantCourseCursor(
        Math.min(
          beat.endTurnIndex,
          beat.startTurnIndex + Math.max(1, value.offsetInBeat ?? 1),
        ),
        turnCount,
      );
    }
    return clampAssistantCourseCursor(value.cursor, turnCount);
  } catch {
    return clampAssistantCourseCursor(Number(raw), turnCount);
  }
}

/** Opening a display must also start its available explanation, without crossing a part boundary. */
export function assistantCourseFirstExplanationIndex(
  turns: readonly AssistantCourseFeedTurn[],
  visibleCount: number,
  partEnd: number,
): number | undefined {
  if (turns[visibleCount - 1]?.kind !== "display") return undefined;
  for (
    let index = visibleCount;
    index < Math.min(partEnd, turns.length);
    index++
  ) {
    const turn = turns[index];
    if (turn?.kind === "lesson" && turn.narration.length) return index;
    if (turn?.kind !== "display") return undefined;
  }
  return undefined;
}
