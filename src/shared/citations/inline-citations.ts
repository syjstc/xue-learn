import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import type {
  LearningMaterialContent,
  InteractiveBlock,
} from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import { compareBlockSides } from "@xue-learn/core/source/src/shared/domain/compare-block.ts";

/** Inline marker in generated text; maps to 1-based index in ContentSource[]. */
export const CITATION_MARKER_RE = /\[\^(\d+)\]/g;

export type CitationSegment =
  | { type: "text"; value: string }
  | { type: "citation"; index: number };

export function parseCitationSegments(text: string): CitationSegment[] {
  if (!text) return [];
  const segments: CitationSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION_MARKER_RE)) {
    const start = match.index ?? 0;
    if (start > last) {
      segments.push({ type: "text", value: text.slice(last, start) });
    }
    segments.push({ type: "citation", index: Number(match[1]) });
    last = start + match[0].length;
  }
  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last) });
  }
  return segments;
}

export function hasCitationMarkers(text: string): boolean {
  return /\[\^\d+\]/.test(text);
}

/** Remove invalid [^n] and strip all markers when there are no sources. */
export function clampCitationMarkers(text: string, maxIndex: number): string {
  if (!text) return text;
  if (maxIndex <= 0) return text.replace(CITATION_MARKER_RE, "");
  return text.replace(CITATION_MARKER_RE, (_, raw: string) => {
    const n = Number(raw);
    return n >= 1 && n <= maxIndex ? `[^${n}]` : "";
  });
}

export function referenceSourceOutputRule(sourceCount: number): string {
  if (sourceCount <= 0) return "";
  return `
Reference-source output rule:
- The numbered labels identify context entries only.
- Use the sources as factual context, but do not include source numbers, citation markers, or footnotes in learner-facing content.`;
}

/** Reference block for LLM prompts (source list + output rule + context body). */
export function buildReferencePromptSection(
  context: string,
  sources: ContentSource[],
): string {
  const parts: string[] = [];
  if (sources.length > 0) {
    parts.push(formatNumberedSourceList(sources));
    parts.push(referenceSourceOutputRule(sources.length).trim());
  }
  const body = context.trim();
  if (body) parts.push(body);
  return parts.join("\n\n");
}

export function formatNumberedSourceList(sources: ContentSource[]): string {
  if (sources.length === 0) return "";
  const lines = sources.map((s, i) => {
    const n = i + 1;
    if (s.kind === "web" && s.url) {
      return `[${n}] ${s.title}\nURL: ${s.url}`;
    }
    return `[${n}] ${s.title}${s.filename ? ` (${s.filename})` : ""}`;
  });
  return `Numbered reference sources (context only; do not reproduce the labels in learner-facing content):\n${lines.join("\n")}`;
}

export function scrollToCitationSource(index: number): void {
  const el = document.getElementById(citationSourceElementId(index));
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  el.classList.add("citation-source-flash");
  window.setTimeout(() => el.classList.remove("citation-source-flash"), 1600);
}

export function citationSourceElementId(index: number): string {
  return `citation-source-${index}`;
}

/** Drop a trailing partial [^12 marker while typewriter is mid-token. */
export function stripTrailingPartialCitation(text: string): string {
  return text.replace(/\[\^?\d*$/, "");
}

function clampBlockText(
  block: InteractiveBlock,
  clamp: (t: string) => string,
): InteractiveBlock {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return { ...block, text: clamp(block.text) };
    case "conversation":
      const [firstTurn, secondTurn, ...remainingTurns] = block.turns;
      const clampTurn = (turn: (typeof block.turns)[number]) => ({
        ...turn,
        speaker: clamp(turn.speaker),
        text: clamp(turn.text),
      });
      return {
        ...block,
        title: block.title ? clamp(block.title) : block.title,
        turns: [
          clampTurn(firstTurn),
          clampTurn(secondTurn),
          ...remainingTurns.map(clampTurn),
        ],
      };
    case "callout":
      return {
        ...block,
        body: clamp(block.body),
        title: block.title ? clamp(block.title) : block.title,
      };
    case "accordion":
      return { ...block, title: clamp(block.title), body: clamp(block.body) };
    case "check":
      return {
        ...block,
        question: clamp(block.question),
        explanation: clamp(block.explanation),
        ...(block.options
          ? { options: block.options.map(clamp) as typeof block.options }
          : {}),
      } as InteractiveBlock;
    case "compare": {
      const sides = compareBlockSides(block);
      return {
        ...block,
        left: {
          ...block.left,
          label: clamp(block.left.label),
          points: block.left.points.map(clamp),
        },
        right: {
          ...block.right,
          label: clamp(block.right.label),
          points: block.right.points.map(clamp),
        },
        ...(block.sides
          ? {
              sides: sides.map((side) => ({
                label: clamp(side.label),
                points: side.points.map(clamp),
              })),
            }
          : {}),
      } as InteractiveBlock;
    }
    case "illustration":
      return { ...block, caption: clamp(block.caption) };
    case "svg":
      return {
        ...block,
        title: block.title ? clamp(block.title) : block.title,
        caption: clamp(block.caption),
        alt: clamp(block.alt),
      };
    default:
      return block;
  }
}

export function clampLearningMaterialCitations(
  material: LearningMaterialContent,
  sourceCount: number,
): LearningMaterialContent {
  const clamp = (t: string) => clampCitationMarkers(t, sourceCount);
  return {
    ...material,
    introduction: material.introduction
      ? clamp(material.introduction)
      : material.introduction,
    keyTakeaways: material.keyTakeaways.map(clamp),
    blocks: material.blocks.map((b) => clampBlockText(b, clamp)),
  };
}
