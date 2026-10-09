import { isDeepStrictEqual } from "node:util";
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
): MaterialGenerationJitItem[] {
  const frozen = Array.isArray(items) ? frozenImageNarration(items) : new Set();
  const candidate = skipProseSplitting ? items : Array.isArray(items)
    ? items.flatMap((item) => frozen.has(item) ? [item] : materialItemsFromProviderPayload([item]))
    : materialItemsFromProviderPayload(items);
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
  }
  const issue = parsed.error.issues[0];
  const path = issue?.path?.length ? issue.path.join(".") : "items";
  throw new Error(
    `Topic material flattened into an invalid section envelope: ${path} ${issue?.message ?? parsed.error.message}`,
  );
}
