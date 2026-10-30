import type {
  InteractiveBlock,
  LearningMaterialContent,
} from "../llm/schemas.js";
import type { ContentSource } from "../types/content-sources.js";
import { compareBlockSides } from "./compare-block.js";
import type { KnowledgeActivity } from "../../../libs/domain/src/index.js";
import { sanitizeToolUserFacingText } from "../../../libs/common/src/agent-user-facing.js";

/** Where in the unit learning material a follow-up thread is anchored. */
export type MaterialAnchor = {
  scope: "introduction" | "key_takeaway" | "block" | "cornell_cue";
  /** Section-local material owner; prevents intro/takeaway anchors leaking into sibling sections. */
  sectionId?: string;
  /** Immutable reading document and block; never resolve against Display material. */
  reading?: { documentId: string; blockId: string };
  /** Index at thread creation time; re-resolved via blockKey when material changes. */
  blockIndex?: number;
  takeawayIndex?: number;
  /** Stable fingerprint of block content (survives reorder better than index alone). */
  blockKey?: string;
  blockType?: InteractiveBlock["type"];
  /**
   * Sub-location within a block, e.g.:
   * - "text" (whole block)
   * - "body" (callout/accordion)
   * - "check.question" | "check.option.1" | "check.explanation" | "check.wrong"
   * - "text.selection" (with textRange + selectedText)
   */
  subPath?: string;
  selectedText?: string;
  textRange?: { start: number; end: number };
  /** Inline check: learner's wrong option index */
  wrongOptionIndex?: number;
  /** DOM content-key for text highlights (e.g. block:2:step:1); defaults from scope/blockIndex */
  highlightKey?: string;
};

export type FollowUpToolUi = {
  toolCallId: string;
  toolName: string;
  uiKind: string;
  args: Record<string, unknown>;
};

export type FollowUpMessage = {
  role: "user" | "assistant";
  content: string;
  quotedText?: string;
  createdAt: string;
  /** RAG / web references used for this assistant reply, when any. */
  sources?: ContentSource[];
  /** Inline action UI (e.g. suggest creating a new learning goal). */
  toolUi?: FollowUpToolUi;
  /** In-flight provider reasoning progress; text is intentionally hidden. */
  thinking?: boolean;
  /** Optional learner activity authored by the follow-up agent. */
  knowledgeActivity?: KnowledgeActivity;
};

export type MaterialFollowUpRecord = {
  id: string;
  unitId: string;
  anchor: MaterialAnchor;
  messages: FollowUpMessage[];
  createdAt: string;
  updatedAt: string;
};

function fnv1a(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Canonical text used to fingerprint a block for stable anchoring. */
export function blockCanonicalText(block: InteractiveBlock): string {
  switch (block.type) {
    case "heading":
      return block.text;
    case "paragraph":
      return block.text;
    case "code":
      return block.code;
    case "conversation":
      return `${block.title ?? ""}|${block.turns.map((turn) => `${turn.speaker}:${turn.text}`).join("|")}`;
    case "callout":
      return `${block.variant}|${block.title ?? ""}|${block.body}`;
    case "accordion":
      return `${block.title}|${block.body}`;
    case "check":
      return `${block.question}|${(block.options ?? []).join("|")}|${block.correctIndex ?? block.correctAnswer}|${block.explanation}`;
    case "compare":
      return compareBlockSides(block)
        .map((side) => side.label)
        .join("|");
    case "step_sort":
      return `${block.title}|${block.correct_sequence.map((item) => item.id).join("|")}`;
    case "graph":
      return `${block.title}|${block.variant}|${block.direction}|${block.nodes.map((item) => item.id).join("|")}`;
    case "chart":
      return `${block.title}|${block.chartType}|${block.summary}`;
    case "math_scene":
      return `${block.title}|${block.dimension}|${block.coordinateSystem}|${block.summary}`;
    case "mechanics_sandbox":
      return `${block.title}|${block.sandboxType}|${block.summary}`;
    case "circuit_sandbox":
      return `${block.title}|${block.summary}|${block.components?.length ?? 0}`;
    case "chemistry_lab":
      return `${block.title}|${block.experimentId}|${block.summary}`;
    case "illustration":
      return `${block.caption}|${block.prompt}|${block.style}`;
    case "svg":
      return `${block.title ?? ""}|${block.caption}|${block.alt}`;
    case "stage":
      return `${block.layout}|${block.figures
        .map((figure) => `${figure.type}:${blockCanonicalText(figure)}`)
        .join("|")}`;
    default:
      return "";
  }
}

export function computeBlockKey(
  block: InteractiveBlock,
  index: number,
): string {
  return `${block.type}:${index}:${fnv1a(blockCanonicalText(block))}`;
}

export function anchorForBlock(
  block: InteractiveBlock,
  blockIndex: number,
  subPath?: string,
  extra?: Pick<
    MaterialAnchor,
    "selectedText" | "textRange" | "wrongOptionIndex" | "highlightKey"
  >,
): MaterialAnchor {
  return {
    scope: "block",
    blockIndex,
    blockKey: computeBlockKey(block, blockIndex),
    blockType: block.type,
    subPath: subPath ?? "text",
    highlightKey: extra?.highlightKey ?? `block:${blockIndex}`,
    ...extra,
  };
}

export function anchorId(anchor: MaterialAnchor): string {
  const key = {
    scope: anchor.scope,
    sectionId: anchor.sectionId,
    blockKey: anchor.blockKey,
    blockIndex: anchor.blockIndex,
    takeawayIndex: anchor.takeawayIndex,
    subPath: anchor.subPath,
    highlightKey: anchor.highlightKey,
    textRange: anchor.textRange,
    wrongOptionIndex: anchor.wrongOptionIndex,
    reading: anchor.reading,
    selectedText: anchor.reading ? anchor.selectedText : undefined,
  };
  return fnv1a(JSON.stringify(key));
}

export function resolveBlockIndex(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): number | null {
  if (anchor.reading || anchor.scope !== "block") return null;

  if (anchor.blockKey) {
    for (let i = 0; i < material.blocks.length; i++) {
      if (computeBlockKey(material.blocks[i], i) === anchor.blockKey) return i;
    }
  }

  if (
    anchor.blockIndex != null &&
    anchor.blockIndex >= 0 &&
    anchor.blockIndex < material.blocks.length
  ) {
    const block = material.blocks[anchor.blockIndex];
    if (!anchor.blockType || block.type === anchor.blockType) {
      return anchor.blockIndex;
    }
  }

  return null;
}

/**
 * Whether a saved follow-up can still be located in the current material.
 *
 * This is intentionally stricter than resolveBlockIndex: when a stable block
 * fingerprint exists, falling back to the same numeric index after a
 * regeneration could jump to unrelated replacement content.
 */
export function canLocateMaterialAnchor(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): boolean {
  if (anchor.reading || anchor.scope === "cornell_cue") return false;

  if (anchor.scope === "introduction") {
    if (!material.introduction) return false;
    return anchor.selectedText
      ? material.introduction.includes(anchor.selectedText)
      : true;
  }

  if (anchor.scope === "key_takeaway") {
    const text = material.keyTakeaways[anchor.takeawayIndex ?? 0];
    if (!text) return false;
    return anchor.selectedText ? text.includes(anchor.selectedText) : true;
  }

  let blockIndex: number | null = null;
  if (anchor.blockKey) {
    blockIndex = material.blocks.findIndex(
      (block, index) => computeBlockKey(block, index) === anchor.blockKey,
    );
    if (blockIndex < 0) return false;
  } else {
    blockIndex = resolveBlockIndex(material, anchor);
  }
  if (blockIndex == null) return false;

  return anchor.selectedText
    ? blockCanonicalText(material.blocks[blockIndex]).includes(
        anchor.selectedText,
      )
    : true;
}

export function anchorLabel(
  anchor: MaterialAnchor,
  material?: LearningMaterialContent | null,
): string {
  if (anchor.scope === "introduction") return "导语";
  if (anchor.scope === "key_takeaway") {
    const i = (anchor.takeawayIndex ?? 0) + 1;
    return `核心要点 ${i}`;
  }
  const idx = material
    ? resolveBlockIndex(material, anchor)
    : anchor.blockIndex;
  const n = idx != null ? idx + 1 : "?";
  if (anchor.subPath?.startsWith("check")) {
    if (anchor.subPath === "check.wrong" || anchor.wrongOptionIndex != null) {
      return `正文测验 · 第 ${n} 块（答错）`;
    }
    if (anchor.subPath === "check.explanation")
      return `正文测验解析 · 第 ${n} 块`;
    return `正文测验 · 第 ${n} 块`;
  }
  if (anchor.selectedText) {
    const preview =
      anchor.selectedText.length > 24
        ? `${anchor.selectedText.slice(0, 24)}…`
        : anchor.selectedText;
    return `选中：「${preview}」`;
  }
  return `正文 · 第 ${n} 块`;
}

export function parseMaterialAnchor(raw: unknown): MaterialAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const reading = o.reading as MaterialAnchor["reading"];
  if (o.reading !== undefined && (!reading || typeof reading !== "object" ||
      typeof reading.documentId !== "string" || !reading.documentId ||
      typeof reading.blockId !== "string" || !reading.blockId ||
      typeof o.sectionId !== "string" || !o.sectionId || o.scope !== "block")) return null;
  if (
    o.scope !== "introduction" &&
    o.scope !== "key_takeaway" &&
    o.scope !== "block" &&
    o.scope !== "cornell_cue"
  ) {
    return null;
  }
  return {
    scope: o.scope as MaterialAnchor["scope"],
    sectionId: typeof o.sectionId === "string" ? o.sectionId : undefined,
    ...(reading ? {reading: {documentId: reading.documentId, blockId: reading.blockId}} : {}),
    blockIndex: typeof o.blockIndex === "number" ? o.blockIndex : undefined,
    takeawayIndex:
      typeof o.takeawayIndex === "number" ? o.takeawayIndex : undefined,
    blockKey: typeof o.blockKey === "string" ? o.blockKey : undefined,
    blockType:
      typeof o.blockType === "string"
        ? (o.blockType as InteractiveBlock["type"])
        : undefined,
    subPath: typeof o.subPath === "string" ? o.subPath : undefined,
    selectedText:
      typeof o.selectedText === "string" ? o.selectedText : undefined,
    textRange:
      o.textRange &&
      typeof o.textRange === "object" &&
      typeof (o.textRange as { start?: unknown }).start === "number" &&
      typeof (o.textRange as { end?: unknown }).end === "number"
        ? {
            start: (o.textRange as { start: number }).start,
            end: (o.textRange as { end: number }).end,
          }
        : undefined,
    wrongOptionIndex:
      typeof o.wrongOptionIndex === "number" ? o.wrongOptionIndex : undefined,
    highlightKey:
      typeof o.highlightKey === "string" ? o.highlightKey : undefined,
  };
}

export function parseFollowUpMessages(raw: unknown): FollowUpMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is FollowUpMessage =>
        !!m &&
        typeof m === "object" &&
        ((m as FollowUpMessage).role === "user" ||
          (m as FollowUpMessage).role === "assistant") &&
        typeof (m as FollowUpMessage).content === "string",
    )
    .map((m) => ({
      role: m.role,
      ...(typeof m.quotedText === "string" ? { quotedText: m.quotedText } : {}),
      content: sanitizeToolUserFacingText(m.content, m.toolUi?.toolName),
      createdAt:
        typeof m.createdAt === "string"
          ? m.createdAt
          : new Date().toISOString(),
      ...(Array.isArray(m.sources) && m.sources.length > 0
        ? { sources: m.sources }
        : {}),
      ...(m.toolUi &&
      typeof m.toolUi === "object" &&
      typeof (m.toolUi as FollowUpToolUi).toolCallId === "string" &&
      typeof (m.toolUi as FollowUpToolUi).uiKind === "string"
        ? { toolUi: m.toolUi as FollowUpToolUi }
        : {}),
      ...(m.knowledgeActivity && typeof m.knowledgeActivity === "object"
        ? { knowledgeActivity: m.knowledgeActivity as KnowledgeActivity }
        : {}),
    }));
}

/** Snippet of anchored content for the LLM prompt. */
export function anchorContextSnippet(
  material: LearningMaterialContent,
  anchor: MaterialAnchor,
): string {
  if (anchor.scope === "introduction") {
    return `【导语】\n${material.introduction}`;
  }
  if (anchor.scope === "key_takeaway") {
    const i = anchor.takeawayIndex ?? 0;
    return `【核心要点 ${i + 1}】\n${material.keyTakeaways[i] ?? ""}`;
  }
  const idx = resolveBlockIndex(material, anchor);
  if (idx == null) return "（锚点正文已变更，请结合单元主题回答）";
  const block = material.blocks[idx];
  const base = `【正文块 ${idx + 1} · ${block.type}】\n${blockCanonicalText(block)}`;
  if (anchor.selectedText) {
    return `${base}\n\n【用户选中】\n${anchor.selectedText}`;
  }
  if (anchor.wrongOptionIndex != null && block.type === "check") {
    const opt = (block.options ?? [])[anchor.wrongOptionIndex];
    return `${base}\n\n【用户错选】${opt ?? anchor.wrongOptionIndex}\n【解析】${block.explanation}`;
  }
  return base;
}
