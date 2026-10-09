import type { z } from "zod";

export type NarratedMaterialSequenceToken = Readonly<{
  kind: "heading" | "paragraph" | "display" | "check";
  sourceIndex: number;
  text?: string;
}>;

export type NarratedMaterialSequenceIssue = Readonly<{
  sourceIndex: number;
  message: string;
}>;

const DENSE_SYMBOL_CHAIN = /(?:[\p{L}\p{N})\]}]\s*(?:→|⇒|⇔|=|≤|≥|<|>)\s*){2,}/u;
const BLOCK_PROSE_MARKUP =
  /(?:^|\n)\s*(?:```|~~~|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|<\/?(?:table|ul|ol|pre|code)\b)/iu;
const MAX_PARAGRAPH_SENTENCES = 3;
const MAX_PARAGRAPH_CHARS = 220;
const SENTENCE_END = /[。！？!?]/u;
const DECIMAL_DOT = /[.．]/u;

function isDecimalPoint(glyphs: readonly string[], index: number): boolean {
  if (!DECIMAL_DOT.test(glyphs[index]!)) return false;
  const prev = glyphs[index - 1];
  const next = glyphs[index + 1];
  return Boolean(prev && next && /\d/u.test(prev) && /\d/u.test(next));
}

/** `fruits.append` / `obj.method` — not an English sentence boundary. */
function isIdentifierDot(glyphs: readonly string[], index: number): boolean {
  if (!DECIMAL_DOT.test(glyphs[index]!)) return false;
  const prev = glyphs[index - 1];
  const next = glyphs[index + 1];
  if (!prev || !next) return false;
  return /[\p{L}\p{N}_)\]}'"`]/u.test(prev) && /[\p{L}_`]/u.test(next);
}

function isSpokenSentenceEnd(glyphs: readonly string[], index: number): boolean {
  const char = glyphs[index]!;
  if (SENTENCE_END.test(char)) return true;
  if (!DECIMAL_DOT.test(char)) return false;
  if (isDecimalPoint(glyphs, index) || isIdentifierDot(glyphs, index)) {
    return false;
  }
  return true;
}

function chunkOverlongSpokenPiece(text: string): string[] {
  if (!text.trim()) return [];
  if (text.trim().length <= MAX_PARAGRAPH_CHARS) return [text];
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > MAX_PARAGRAPH_CHARS) {
    const window = rest.slice(0, MAX_PARAGRAPH_CHARS);
    const breakAt = Math.max(
      window.lastIndexOf("，"),
      window.lastIndexOf("；"),
      window.lastIndexOf(";"),
      window.lastIndexOf("、"),
      window.lastIndexOf(" "),
    );
    const cut = breakAt >= 24 ? breakAt + 1 : MAX_PARAGRAPH_CHARS;
    const head = rest.slice(0, cut);
    if (head.trim()) chunks.push(head);
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest);
  return chunks.length > 0 ? chunks : [text];
}

/** Clause pieces that end at true sentence punctuation, never at 3.9 / 1.999. */
export function splitSpokenSentencePieces(text: string): string[] {
  const glyphs = [...text.trim()];
  if (glyphs.length === 0) return [];
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < glyphs.length; index += 1) {
    if (!isSpokenSentenceEnd(glyphs, index)) continue;
    while (
      index + 1 < glyphs.length &&
      isSpokenSentenceEnd(glyphs, index + 1)
    ) {
      index += 1;
    }
    const piece = glyphs.slice(start, index + 1).join("");
    if (piece.trim()) parts.push(piece);
    start = index + 1;
  }
  const tail = glyphs.slice(start).join("");
  if (tail.trim()) parts.push(tail);
  return parts;
}

/** Split a spoken paragraph into beats that satisfy the narration contract. */
export function splitSpokenParagraphBeats(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const pieces = splitSpokenSentencePieces(trimmed);
  const beats: string[] = [];
  let current = "";
  let sentenceCount = 0;
  const flush = () => {
    if (!current.trim()) return;
    beats.push(current.trim());
    current = "";
    sentenceCount = 0;
  };
  for (const piece of pieces) {
    if (!piece) continue;
    const parts = chunkOverlongSpokenPiece(piece);
    for (const part of parts) {
      if (
        current &&
        (sentenceCount >= MAX_PARAGRAPH_SENTENCES ||
          current.length + part.length > MAX_PARAGRAPH_CHARS)
      ) {
        flush();
      }
      current = current ? `${current}${part}` : part;
      sentenceCount += 1;
    }
  }
  flush();
  return beats.length > 0 ? beats : [trimmed];
}

export function paragraphNarrationIssues(
  text: string,
  sourceIndex = 0,
): NarratedMaterialSequenceIssue[] {
  return paragraphIssues({ kind: "paragraph", sourceIndex, text });
}

function paragraphIssues(token: NarratedMaterialSequenceToken) {
  const issues: NarratedMaterialSequenceIssue[] = [];
  const text = token.text?.trim() ?? "";
  if (!text) {
    issues.push({
      sourceIndex: token.sourceIndex,
      message: "paragraph narration must not be empty",
    });
    return issues;
  }
  if (DENSE_SYMBOL_CHAIN.test(text)) {
    issues.push({
      sourceIndex: token.sourceIndex,
      message:
        "paragraph narration must verbalize symbolic chains instead of displaying them",
    });
  }
  if (BLOCK_PROSE_MARKUP.test(text)) {
    issues.push({
      sourceIndex: token.sourceIndex,
      message:
        "paragraph narration cannot contain lists, headings, code fences, or block HTML",
    });
  }
  return issues;
}

/**
 * Validate the authored teaching spine:
 * heading -> display -> paragraph+ -> [display -> paragraph+]*.
 * Server-owned checks are transparent and an assessment-only heading is
 * allowed because checks are compiled into separate video scenes.
 */
export function validateNarratedMaterialSequence(
  tokens: readonly NarratedMaterialSequenceToken[],
): NarratedMaterialSequenceIssue[] {
  const issues = tokens.flatMap((token) =>
    token.kind === "paragraph" ? paragraphIssues(token) : [],
  );
  const headings = tokens.flatMap((token, index) =>
    token.kind === "heading" ? [index] : [],
  );
  if (headings.length === 0) {
    const firstTeaching = tokens.find((token) => token.kind !== "check");
    if (firstTeaching) {
      issues.push({
        sourceIndex: firstTeaching.sourceIndex,
        message: "material must start each narrated topic with a heading",
      });
    }
    return issues;
  }

  const beforeFirstHeading = tokens
    .slice(0, headings[0])
    .find((token) => token.kind !== "check");
  if (beforeFirstHeading) {
    issues.push({
      sourceIndex: beforeFirstHeading.sourceIndex,
      message: "teaching blocks cannot appear before the first heading",
    });
  }

  headings.forEach((headingIndex, position) => {
    const end = headings[position + 1] ?? tokens.length;
    const rawGroup = tokens.slice(headingIndex + 1, end);
    const group = rawGroup.filter((token) => token.kind !== "check");
    if (group.length === 0) {
      if (rawGroup.some((token) => token.kind === "check")) return;
      issues.push({
        sourceIndex: tokens[headingIndex]!.sourceIndex,
        message: "each heading must contain a narrated display block",
      });
      return;
    }

    if (group[0]?.kind !== "display") {
      issues.push({
        sourceIndex: group[0]?.sourceIndex ?? tokens[headingIndex]!.sourceIndex,
        message: "each heading must introduce a display block before narration",
      });
    }

    let pendingDisplay: NarratedMaterialSequenceToken | null = null;
    for (const token of group) {
      if (token.kind === "display") {
        if (pendingDisplay) {
          issues.push({
            sourceIndex: pendingDisplay.sourceIndex,
            message:
              "each display block must be followed by a paragraph narration",
          });
        }
        pendingDisplay = token;
      } else if (token.kind === "paragraph" && pendingDisplay) {
        pendingDisplay = null;
      }
    }
    if (pendingDisplay) {
      issues.push({
        sourceIndex: pendingDisplay.sourceIndex,
        message: "each display block must be followed by a paragraph narration",
      });
    }
  });

  return issues;
}

export function addNarratedMaterialSequenceIssues(
  tokens: readonly NarratedMaterialSequenceToken[],
  context: z.RefinementCtx,
  pathPrefix: readonly (string | number)[] = [],
) {
  for (const issue of validateNarratedMaterialSequence(tokens)) {
    context.addIssue({
      code: "custom",
      path: [...pathPrefix, issue.sourceIndex],
      message: issue.message,
    });
  }
}

export function isNarratedMaterialSequence(
  tokens: readonly NarratedMaterialSequenceToken[],
) {
  return validateNarratedMaterialSequence(tokens).length === 0;
}

export function narratedTokensFromBlocks(
  blocks: readonly Readonly<{ type: string; text?: unknown }>[],
): NarratedMaterialSequenceToken[] {
  return blocks.map((block, sourceIndex) => ({
    kind:
      block.type === "heading"
        ? ("heading" as const)
        : block.type === "paragraph"
          ? ("paragraph" as const)
          : block.type === "check"
            ? ("check" as const)
            : ("display" as const),
    sourceIndex,
    text: typeof block.text === "string" ? block.text : undefined,
  }));
}

export function assertNarratedMaterialBlocks(
  blocks: readonly Readonly<{ type: string; text?: unknown }>[],
) {
  const issues = validateNarratedMaterialSequence(
    narratedTokensFromBlocks(blocks),
  );
  if (issues.length === 0) return;
  throw new Error(
    `invalid narrated material sequence: ${issues
      .map((issue) => `blocks[${issue.sourceIndex}] ${issue.message}`)
      .join("; ")}`,
  );
}
