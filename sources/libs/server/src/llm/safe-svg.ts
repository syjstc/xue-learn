import { z } from "zod";
import { normalizeCourseSvgTextPaint } from "../../../domain/src/index.js";

/** Raw SVG is authored course content and may use native styles or animation. */
export const safeCourseSvgMarkupSchema = z.string().trim().min(1).max(60_000);

const FORBIDDEN_COURSE_SVG_MARKUP =
  /<(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|\/\/)/iu;

/** Reject executable and externally loaded markup before render or publish. */
export function assertCourseSvgRenderable(svg: string): string {
  const normalized = svg.trim();
  if (!normalized.startsWith("<svg") || !normalized.endsWith("</svg>")) {
    throw new Error("A complete SVG document is required");
  }
  if (normalized.length > 60_000) {
    throw new Error("SVG exceeds the 60,000 character limit");
  }
  if (FORBIDDEN_COURSE_SVG_MARKUP.test(normalized)) {
    throw new Error("SVG contains executable or external-resource markup");
  }
  return normalized;
}

/** Keep persisted SVG code intact, including native styles and animation. */
export function normalizeGeneratedCourseSvg(value: string): string {
  return normalizeCourseSvgTextPaint(value.trim());
}
