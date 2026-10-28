import {
  anchorId,
  blockCanonicalText,
  resolveBlockIndex,
  type MaterialAnchor,
} from "./material-anchor.js";
import { compareBlockSides } from "./compare-block.js";
import type { LearningMaterialContent } from "../llm/schemas.js";
import {
  extractMarkdownCodeBlocks,
  markdownCodeBlockTargets,
} from "../markdown/code-blocks.js";

export type TextHighlightSpan = {
  start: number;
  end: number;
  aid: string;
  threadId?: string;
  active: boolean;
};

export type LocatedTextSelection = {
  key: string;
  start: number;
  end: number;
};

/** DOM / render key for a highlightable text container. */
export function contentKeyForAnchor(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): string | null {
  if (anchor.highlightKey) {
    return resolveLegacyHighlightKey(material, anchor) ?? anchor.highlightKey;
  }
  if (anchor.scope === "introduction") return "intro";
  if (anchor.scope === "key_takeaway") {
    return `takeaway:${anchor.takeawayIndex ?? 0}`;
  }
  if (anchor.scope === "block") {
    const idx = resolveBlockIndex(material, anchor);
    if (idx != null) return `block:${idx}`;
  }
  return null;
}

/** Map legacy block-level keys to region-specific keys when unambiguous. */
function resolveLegacyHighlightKey(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): string | null {
  if (anchor.subPath !== "text.selection" || !anchor.selectedText) return null;
  const legacy = anchor.highlightKey?.match(/^block:(\d+)$/);
  if (!legacy) return null;

  const idx = Number(legacy[1]);
  const block = material.blocks[idx];
  if (!block) return null;

  const base = `block:${idx}`;

  if (block.type === "code" && block.code.includes(anchor.selectedText)) {
    return base;
  }

  if (block.type === "check") {
    if (
      anchor.textRange &&
      block.explanation.slice(anchor.textRange.start, anchor.textRange.end) ===
        anchor.selectedText
    ) {
      return `${base}:check:explanation`;
    }
    if (
      anchor.textRange &&
      block.question.slice(anchor.textRange.start, anchor.textRange.end) ===
        anchor.selectedText
    ) {
      return `${base}:check:question`;
    }
    if (block.explanation.includes(anchor.selectedText)) {
      return `${base}:check:explanation`;
    }
    if (block.question.includes(anchor.selectedText)) {
      return `${base}:check:question`;
    }
    for (
      let optionIndex = 0;
      optionIndex < (block.options ?? []).length;
      optionIndex++
    ) {
      const option = block.options![optionIndex]!;
      if (
        anchor.textRange &&
        option.slice(anchor.textRange.start, anchor.textRange.end) ===
          anchor.selectedText
      ) {
        return `${base}:check:option:${optionIndex}`;
      }
      if (option.includes(anchor.selectedText)) {
        return `${base}:check:option:${optionIndex}`;
      }
    }
    const questionCodeBlocks = extractMarkdownCodeBlocks(block.question);
    for (let i = 0; i < questionCodeBlocks.length; i++) {
      const code = questionCodeBlocks[i]!;
      if (
        anchor.textRange &&
        code.slice(anchor.textRange.start, anchor.textRange.end) ===
          anchor.selectedText
      ) {
        return `${base}:check:question:code:${i}`;
      }
      if (code.includes(anchor.selectedText)) {
        return `${base}:check:question:code:${i}`;
      }
    }
    const explanationCodeBlocks = extractMarkdownCodeBlocks(block.explanation);
    for (let i = 0; i < explanationCodeBlocks.length; i++) {
      const code = explanationCodeBlocks[i]!;
      if (
        anchor.textRange &&
        code.slice(anchor.textRange.start, anchor.textRange.end) ===
          anchor.selectedText
      ) {
        return `${base}:check:explanation:code:${i}`;
      }
      if (code.includes(anchor.selectedText)) {
        return `${base}:check:explanation:code:${i}`;
      }
    }
  }

  const markdownBody =
    block.type === "paragraph" || block.type === "heading"
      ? block.text
      : block.type === "code"
        ? block.code
        : block.type === "callout"
          ? block.body
          : block.type === "accordion"
            ? block.body
            : null;
  if (markdownBody) {
    const codeBlocks = extractMarkdownCodeBlocks(markdownBody);
    for (let i = 0; i < codeBlocks.length; i++) {
      const code = codeBlocks[i]!;
      if (
        anchor.textRange &&
        code.slice(anchor.textRange.start, anchor.textRange.end) ===
          anchor.selectedText
      ) {
        return `${base}:code:${i}`;
      }
      if (code.includes(anchor.selectedText)) {
        return `${base}:code:${i}`;
      }
    }
  }

  return null;
}

export type OpenFollowUpMeta = {
  rect?: DOMRect;
  threadId?: string;
  blockIndex?: number;
  /** Start a separate unit-scoped thread even when this anchor was asked about before. */
  newThread?: boolean;
  /** When set, opens the follow-up panel and sends this message without user input. */
  autoMessage?: string;
};

export function buildTextHighlightMap(
  material: LearningMaterialContent,
  anchors: { anchor: MaterialAnchor; threadId?: string; aid?: string }[],
  activeAnchorId: string | null,
): Map<string, TextHighlightSpan[]> {
  const map = new Map<string, TextHighlightSpan[]>();
  const seen = new Set<string>();

  for (const { anchor, threadId, aid: providedAid } of anchors) {
    if (anchor.subPath !== "text.selection") continue;
    const aid = providedAid ?? anchorId(anchor);
    if (seen.has(aid)) continue;
    seen.add(aid);

    const located = locateTextSelectionInMaterial(material, anchor);
    if (!located) continue;
    const list = map.get(located.key) ?? [];
    list.push({
      start: located.start,
      end: located.end,
      aid,
      threadId,
      active: aid === activeAnchorId,
    });
    map.set(located.key, list);
  }

  for (const spans of map.values()) {
    spans.sort((a, b) => a.start - b.start);
  }
  return map;
}

/**
 * Locate a saved selection in the current material.
 *
 * Prefer its original rendered region. After regeneration, relocate only when
 * the exact quote has one unambiguous occurrence across the current material.
 */
export function locateTextSelectionInMaterial(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): LocatedTextSelection | null {
  if (anchor.subPath !== "text.selection") return null;
  const selectedText = anchor.selectedText?.trim();
  if (!selectedText) return null;

  const preferredTargets = renderedTextTargetsForAnchor(material, anchor);
  const preferredKey = contentKeyForAnchor(material, anchor);
  if (anchor.textRange && preferredKey) {
    const target = preferredTargets.find((item) => item.key === preferredKey);
    if (
      target?.text.slice(anchor.textRange.start, anchor.textRange.end) ===
      selectedText
    ) {
      return {
        key: target.key,
        start: anchor.textRange.start,
        end: anchor.textRange.end,
      };
    }
  }

  const preferredMatches = exactTextMatches(preferredTargets, selectedText);
  if (preferredMatches.length === 1) return preferredMatches[0]!;

  const allMatches = exactTextMatches(
    renderedTextTargetsForMaterial(material),
    selectedText,
  );
  return allMatches.length === 1 ? allMatches[0]! : null;
}

function exactTextMatches(
  targets: Array<{ key: string; text: string }>,
  selectedText: string,
): LocatedTextSelection[] {
  const matches: LocatedTextSelection[] = [];
  for (const target of targets) {
    let start = target.text.indexOf(selectedText);
    while (start >= 0) {
      matches.push({
        key: target.key,
        start,
        end: start + selectedText.length,
      });
      start = target.text.indexOf(selectedText, start + selectedText.length);
    }
  }
  return matches;
}

function renderedTextTargetsForMaterial(
  material: LearningMaterialContent,
): Array<{ key: string; text: string }> {
  return [
    ...renderedTextTargetsForAnchor(material, {
      scope: "introduction",
    }),
    ...material.keyTakeaways.flatMap((_, takeawayIndex) =>
      renderedTextTargetsForAnchor(material, {
        scope: "key_takeaway",
        takeawayIndex,
      }),
    ),
    ...material.blocks.flatMap((block, blockIndex) =>
      renderedTextTargetsForAnchor(material, {
        scope: "block",
        blockIndex,
        blockType: block.type,
      }),
    ),
  ];
}

export function rectToAnchorPosition(rect: DOMRect) {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom,
  };
}

export type PopupAnchorPosition = ReturnType<typeof rectToAnchorPosition>;

function textForAnchor(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): string | null {
  if (anchor.scope === "introduction") {
    return material.introduction || null;
  }
  if (anchor.scope === "key_takeaway") {
    return material.keyTakeaways[anchor.takeawayIndex ?? 0] ?? null;
  }
  if (anchor.scope !== "block") return null;
  const idx = resolveBlockIndex(material, anchor);
  if (idx == null) return null;
  const block = material.blocks[idx];
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.text;
    case "code":
      return block.code;
    case "conversation":
      return [
        block.title ?? "",
        ...block.turns.map((turn) => `${turn.speaker}: ${turn.text}`),
      ]
        .filter(Boolean)
        .join("\n");
    case "callout":
      return `${block.title ?? ""}\n${block.body}`.trim();
    case "accordion":
      return `${block.title}\n${block.body}`.trim();
    case "check":
      return `${block.question}\n${block.explanation}`.trim();
    case "compare":
      return compareBlockSides(block)
        .map((side) => `${side.label}: ${side.points.join("；")}`)
        .join("\n");
    case "illustration":
      return block.caption;
    case "svg":
      return `${block.title ?? ""}\n${block.caption}\n${block.alt}`.trim();
    case "chemistry_lab":
      return `${block.title}\n${block.summary}\n${block.experimentId}`.trim();
    case "stage":
      return block.figures
        .map((figure) => blockCanonicalText(figure))
        .filter(Boolean)
        .join("\n");
    default:
      return null;
  }
}

function renderedTextTargetsForAnchor(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): Array<{ key: string; text: string }> {
  const key = contentKeyForAnchor(material, anchor);
  if (anchor.scope === "introduction") {
    return material.introduction
      ? [
          { key: "intro", text: material.introduction },
          ...markdownCodeBlockTargets("intro", material.introduction),
        ]
      : [];
  }
  if (anchor.scope === "key_takeaway") {
    const takeawayIndex = anchor.takeawayIndex ?? 0;
    const text = material.keyTakeaways[takeawayIndex];
    const key = `takeaway:${takeawayIndex}`;
    return text ? [{ key, text }, ...markdownCodeBlockTargets(key, text)] : [];
  }
  if (anchor.scope !== "block") {
    return [];
  }

  const idx = resolveBlockIndex(material, anchor);
  if (idx == null) return [];
  const block = material.blocks[idx];
  const blockKey = `block:${idx}`;

  switch (block.type) {
    case "heading":
    case "paragraph":
      return [
        { key: blockKey, text: block.text },
        ...markdownCodeBlockTargets(blockKey, block.text),
      ];
    case "code":
      return [{ key: blockKey, text: block.code }];
    case "conversation":
      return [
        ...(block.title
          ? [{ key: `${blockKey}:title`, text: block.title }]
          : []),
        ...block.turns.flatMap((turn, turnIndex) => {
          const turnKey = `${blockKey}:turn:${turnIndex}`;
          return [
            { key: turnKey, text: turn.text },
            ...markdownCodeBlockTargets(turnKey, turn.text),
          ];
        }),
      ];
    case "callout":
      return [
        ...(block.title
          ? [{ key: `${blockKey}:title`, text: block.title }]
          : []),
        { key: blockKey, text: block.body },
        ...markdownCodeBlockTargets(blockKey, block.body),
      ];
    case "accordion":
      return [
        { key: `${blockKey}:title`, text: block.title },
        { key: blockKey, text: block.body },
        ...markdownCodeBlockTargets(blockKey, block.body),
      ];
    case "check":
      return [
        { key: `${blockKey}:check:question`, text: block.question },
        ...markdownCodeBlockTargets(
          `${blockKey}:check:question`,
          block.question,
        ),
        ...(block.options ?? []).map((text, optionIndex) => ({
          key: `${blockKey}:check:option:${optionIndex}`,
          text,
        })),
        { key: `${blockKey}:check:explanation`, text: block.explanation },
        ...markdownCodeBlockTargets(
          `${blockKey}:check:explanation`,
          block.explanation,
        ),
      ];
    case "compare":
      return compareBlockSides(block).flatMap((side, sideIndex) =>
        side.points.map((point, pointIndex) => ({
          key: `${blockKey}:side:${sideIndex}:${pointIndex}`,
          text: point,
        })),
      );
    case "illustration":
      return [{ key: blockKey, text: block.caption }];
    case "svg":
      return [
        ...(block.title
          ? [{ key: `${blockKey}:title`, text: block.title }]
          : []),
        { key: blockKey, text: block.caption },
      ];
    default: {
      const text = key ? textForAnchor(material, anchor) : null;
      return key && text ? [{ key, text }] : [];
    }
  }
}

/** Highlight source excerpt text inside the anchored learning-material region. */
export function buildSourceExcerptHighlights(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
  excerpt: string,
): Map<string, TextHighlightSpan[]> {
  const map = new Map<string, TextHighlightSpan[]>();
  const targets = renderedTextTargetsForAnchor(material, anchor).filter(
    (target) => target.text.trim(),
  );
  if (!targets.length || !excerpt.trim()) return map;

  const candidates = [
    excerpt.trim(),
    excerpt.split("→")[0]?.trim(),
    excerpt.replace(/^【[^】]+】\n?/g, "").trim(),
    ...excerpt
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length >= 8),
  ].filter(
    (value, index, arr) => value && arr.indexOf(value) === index,
  ) as string[];

  for (const needle of candidates) {
    for (const target of targets) {
      const idx = target.text.indexOf(needle);
      if (idx >= 0) {
        map.set(target.key, [
          {
            start: idx,
            end: idx + needle.length,
            aid: "flashcard-source",
            active: true,
          },
        ]);
        return map;
      }
      if (needle.length >= 12) {
        const short = needle.slice(0, Math.min(needle.length, 48));
        const fuzzy = target.text.indexOf(short);
        if (fuzzy >= 0) {
          map.set(target.key, [
            {
              start: fuzzy,
              end: fuzzy + short.length,
              aid: "flashcard-source",
              active: true,
            },
          ]);
          return map;
        }
      }
    }
  }

  return map;
}
