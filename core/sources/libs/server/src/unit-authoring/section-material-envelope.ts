import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  materialGenerationJitItemSchema,
  materialItemsFromProviderPayload,
  type MaterialGenerationJitItem,
} from "../llm/jit-structured-items.js";
import { splitSpokenParagraphBeats } from "../llm/narrated-material-sequence.js";

function containsGuidedImage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const block = value as { type?: string; guidedImage?: unknown; figures?: unknown[] };
  return Boolean(block.type === "illustration" && block.guidedImage) ||
    (block.type === "stage" && Boolean(block.figures?.some(containsGuidedImage)));
}

function frozenImageNarration(items: readonly unknown[]): Set<unknown> {
  const frozen = new Set<unknown>();
  let imageTopic = false;
  for (const item of items) {
    const value = item as { kind?: string; block?: { type?: string } } | null;
    if (value?.kind !== "block") continue;
    if (value.block?.type === "heading") imageTopic = false;
    if (containsGuidedImage(value.block)) imageTopic = true;
    if (imageTopic && value.block?.type === "paragraph") frozen.add(item);
  }
  return frozen;
}

/** Fit accepted topics without discarding narration or replaying authoring. */
export function parseFlattenedMaterialItems(
  items: unknown,
  resultSchema: z.ZodType<MaterialGenerationJitItem[]>,
  skipProseSplitting = false,
  repair?: {textSha256: string; punctuationIndex: number},
): MaterialGenerationJitItem[] {
  const frozenOriginal = Array.isArray(items) ? frozenImageNarration(items) : new Set();
  const candidate = skipProseSplitting ? items : Array.isArray(items)
    ? items.flatMap((item) => frozenOriginal.has(item) ? [item] : materialItemsFromProviderPayload([item]))
    : materialItemsFromProviderPayload(items);
  const frozen = Array.isArray(candidate) ? frozenImageNarration(candidate) : new Set();
  let parsed = resultSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  const onlyBlockBudget = () => !parsed.success && parsed.error.issues.every((issue) =>
    (issue.code === "too_big" && issue.path.length === 0) ||
    (issue.code === "custom" && /^material allows at most \d+ authored block-producing items/.test(issue.message)),
  );
  // Image-bound beats are frozen. Other topics may join only adjacent, identical
  // visual cues, with no action boundary and no extra prose splitting afterward.
  if (onlyBlockBudget() && Array.isArray(candidate)) {
    const compacted = [...candidate];
    // Adjacent paragraphs with the *same* visual cue may be repartitioned at
    // sentence boundaries without changing any words or highlighting. This
    // retains the normal three-sentence/220-character speech beat limit and
    // does not touch image-bound narration or action/music boundaries.
    for (let start = 0; start < compacted.length;) {
      if (frozen.has(compacted[start])) { start++; continue; }
      const first = materialGenerationJitItemSchema.safeParse(compacted[start]);
      if (!first.success || first.data.kind !== "block" || first.data.block.type !== "paragraph" ||
        !first.data.block.cue || first.data.block.cue.music || first.data.block.cue.op) { start++; continue; }
      const base = first.data.block;
      const {text: _firstText, ...baseShape} = base;
      let end = start + 1;
      const texts = [base.text];
      while (end < compacted.length && !frozen.has(compacted[end])) {
        const next = materialGenerationJitItemSchema.safeParse(compacted[end]);
        if (!next.success || next.data.kind !== "block" || next.data.block.type !== "paragraph") break;
        const {text, ...shape} = next.data.block;
        if (!isDeepStrictEqual(baseShape, shape)) break;
        texts.push(text); end++;
      }
      if (texts.length > 1) {
        const source = texts.join("\n");
        const beats = splitSpokenParagraphBeats(source);
        const withoutWhitespace = (value: string) => value.replace(/\s/gu, "");
        if (beats.length < texts.length && withoutWhitespace(beats.join("")) === withoutWhitespace(source)) {
          compacted.splice(start, texts.length, ...beats.map((text) => ({kind: "block", block: {...base, text}})));
          start += beats.length;
          continue;
        }
      }
      start = end;
    }
    parsed = resultSchema.safeParse(compacted);
    if (parsed.success) {
      const prose = (values: readonly unknown[]) => values.map((item) => {
        const v = item as {kind?: string; block?: {type?: string; text?: unknown}};
        return v?.kind === "block" && v.block?.type === "paragraph" && typeof v.block.text === "string" ? v.block.text : "";
      }).join("").replace(/\s/gu, "");
      if (prose(candidate) !== prose(parsed.data)) throw new Error("Section reflow changed narration text");
      return parsed.data;
    }
    if (!onlyBlockBudget()) {
      const issue = parsed.error.issues[0];
      throw new Error(`Topic material flattened into an invalid section envelope: ${issue?.path?.length ? issue.path.join(".") : "items"} ${issue?.message ?? parsed.error.message}`);
    }
    for (let index = compacted.length - 1; index > 0; index--) {
      if (frozen.has(compacted[index - 1]) || frozen.has(compacted[index])) continue;
      const left = materialGenerationJitItemSchema.safeParse(compacted[index - 1]);
      const right = materialGenerationJitItemSchema.safeParse(compacted[index]);
      if (!left.success || !right.success || left.data.kind !== "block" || right.data.kind !== "block") continue;
      const a = left.data.block;
      const b = right.data.block;
      if (a.type !== "paragraph" || b.type !== "paragraph" || !a.cue || !b.cue ||
        a.cue.music || b.cue.music || a.cue.op || b.cue.op || !isDeepStrictEqual(a.cue, b.cue)) continue;
      const text = `${a.text}\n${b.text}`;
      if (splitSpokenParagraphBeats(text).length !== 1) continue;
      compacted.splice(index - 1, 2, { kind: "block", block: { ...a, text } });
      parsed = resultSchema.safeParse(compacted);
      if (parsed.success) return parsed.data;
      if (!onlyBlockBudget()) break;
    }
    if (onlyBlockBudget() && repair) {
      // A reviewer may stage one exact, section-bound punctuation correction.
      // It cannot alter words, image-bound narration, cue data, or the gate.
      const matches = candidate.flatMap((item, index) => {
        if (frozen.has(item)) return [];
        const parsedItem = materialGenerationJitItemSchema.safeParse(item);
        if (!parsedItem.success || parsedItem.data.kind !== "block" || parsedItem.data.block.type !== "paragraph") return [];
        const block = parsedItem.data.block;
        if (!block.cue || block.cue.op || block.cue.music ||
          createHash("sha256").update(block.text).digest("hex") !== repair.textSha256) return [];
        return [{index, block}];
      });
      if (matches.length !== 1) throw new Error("Staged section punctuation does not match exactly one eligible paragraph");
      const {index, block} = matches[0]!;
      if (!Number.isSafeInteger(repair.punctuationIndex) || repair.punctuationIndex <= 0 ||
        repair.punctuationIndex >= block.text.length - 1 || block.text[repair.punctuationIndex] !== "。")
        throw new Error("Invalid staged section punctuation position");
      const corrected = block.text.slice(0, repair.punctuationIndex) + "；" + block.text.slice(repair.punctuationIndex + 1);
      const revised = [...candidate];
      revised[index] = {kind: "block", block: {...block, text: corrected}};
      return parseFlattenedMaterialItems(revised, resultSchema, true);
    }
  }
  const issue = parsed.error.issues[0];
  const path = issue?.path?.length ? issue.path.join(".") : "items";
  throw new Error(
    `Topic material flattened into an invalid section envelope: ${path} ${issue?.message ?? parsed.error.message}`,
  );
}
