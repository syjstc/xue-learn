import { z } from "zod";
import { stripInternalLearningTargetRefs } from "../llm/learner-facing-text.js";

export const UNIT_KEY_POINTS_OPERATION = "unit.key_points" as const;
export const MAX_UNIT_KEY_POINTS = 8;
export const MAX_KEY_POINT_CHARS = 120;

const pointSchema = z
  .string()
  .overwrite(stripInternalLearningTargetRefs)
  .trim()
  .min(1)
  .max(MAX_KEY_POINT_CHARS);

export const unitKeyPointsCommitBindingSchema = z.object({
  points: z.array(z.string()),
});

export function unitKeyPointsCountBounds(sectionCount: number): {
  min: number;
  max: number;
} {
  const sections = Math.max(1, sectionCount);
  return {
    min: sections,
    max: Math.min(MAX_UNIT_KEY_POINTS, sections * 2),
  };
}

export function unitKeyPointsResultSchema(sectionCount: number) {
  const { min, max } = unitKeyPointsCountBounds(sectionCount);
  return z.object({
    points: z.array(pointSchema).min(min).max(max),
  });
}

export function keyPointsFromCommitArgs(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { points?: unknown }).points)
  ) {
    return value;
  }
  return value;
}

export function normalizedKeyPointText(text: string): string {
  return text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function uniqueKeyPointTexts(points: readonly string[]): string[] {
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

export function distributeKeyPoints(
  points: readonly string[],
  sectionCount: number,
): string[][] {
  const n = Math.max(1, sectionCount);
  const cleaned = points.map((point) => point.trim()).filter(Boolean);
  const extras = Math.max(0, cleaned.length - n);
  const buckets: string[][] = [];
  let index = 0;
  for (let section = 0; section < n; section += 1) {
    const take = Math.min(
      2,
      Math.max(0, cleaned.length - index),
      1 + (section < extras ? 1 : 0),
    );
    buckets.push(uniqueKeyPointTexts(cleaned.slice(index, index + take)));
    index += take;
  }
  if (index < cleaned.length) {
    buckets[n - 1] = uniqueKeyPointTexts([
      ...(buckets[n - 1] ?? []),
      ...cleaned.slice(index),
    ]);
  }
  return buckets;
}

export function buildKeyPointsHistoryContinuationPrompt(input: {
  unitTitle: string;
  sectionCount: number;
  languageBlock: string;
  styleBlock?: string;
  catalog: string;
}): string {
  const { min, max } = unitKeyPointsCountBounds(input.sectionCount);
  return `Author this unit's course key points for "${input.unitTitle}".
Topic material is already accepted in this conversation. Do not rewrite Survey or material.
Write ${min} to ${max} one-sentence learner takeaways: 1 or 2 points per content section, concatenated in section order.
Each point is a complete spoken sentence, not a topic title, not a bullet fragment, and not TeX.
Call exactly one commit_key_points tool with {"points":["..."]}, containing all sections in one points array.
Do not call other tools, emit multiple commits, or return the points as plain text.
${input.styleBlock?.trim() ? `${input.styleBlock.trim()}\n` : ""}${input.languageBlock.trim()}
${input.catalog.trim() ? `\nSections:\n${input.catalog.trim()}` : ""}`;
}

export function buildKeyPointsStandalonePrompt(input: {
  unitTitle: string;
  sectionCount: number;
  goalBlock: string;
  languageBlock: string;
  styleBlock?: string;
  catalog: string;
}): string {
  const { min, max } = unitKeyPointsCountBounds(input.sectionCount);
  return `Author this unit's course key points for "${input.unitTitle}".
Write ${min} to ${max} one-sentence learner takeaways: 1 or 2 points per content section, concatenated in section order.
Each point is a complete spoken sentence grounded only in the section topics below. Do not invent extra claims. Do not copy topic titles.
${input.goalBlock}
${input.styleBlock?.trim() ? `${input.styleBlock.trim()}\n` : ""}${input.languageBlock.trim()}

Return {"points":["..."]}.

Sections:
${input.catalog.trim()}`;
}
