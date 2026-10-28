import { z } from "zod";
import { invokeWithSchema } from "./structured-invoke.js";

const ICON_TINTS = [
  "#EEF0FF",
  "#E8F0FF",
  "#E8F7EF",
  "#FFF3D7",
  "#F4EAFE",
  "#FFE8EE",
] as const;

export const goalIconSchema = z.object({
  tint: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  svg: z.string().min(20).max(6000),
});

export type GoalIconResult = z.infer<typeof goalIconSchema>;

const SCHEMA_SHAPE = `{
  "tint": "#EEF0FF",
  "svg": "<svg viewBox=\\"0 0 24 24\\" xmlns=\\"http://www.w3.org/2000/svg\\">...</svg>"
}`;

/** Strip unsafe SVG content before storing or rendering. */
export function sanitizeGoalIconSvg(raw: string): string {
  let svg = raw.trim();
  if (!svg.startsWith("<svg")) {
    const match = svg.match(/<svg[\s\S]*<\/svg>/i);
    svg = match?.[0]?.trim() ?? "";
  }
  if (!svg) return "";

  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\s(href|xlink:href)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, "");

  if (!/^<svg[\s>]/i.test(svg)) return "";
  return svg;
}

function fallbackTint(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return ICON_TINTS[hash % ICON_TINTS.length];
}

export async function generateGoalIcon(title: string): Promise<{
  svg: string;
  tint: string;
}> {
  const result = await invokeWithSchema(goalIconSchema, buildGoalIconPrompt(title), {
    operation: "goal.icon",
    schemaShape: SCHEMA_SHAPE,
    meta: { title },
  });

  const svg = sanitizeGoalIconSvg(result.svg);
  if (!svg) {
    return { svg: defaultGoalIconSvg(), tint: fallbackTint(title) };
  }

  return {
    svg,
    tint: result.tint && /^#[0-9A-Fa-f]{6}$/.test(result.tint)
      ? result.tint
      : fallbackTint(title),
  };
}

function buildGoalIconPrompt(title: string): string {
  return `You design minimal learning-app icons.

Create a simple, recognizable SVG icon for this learning goal:
"${title}"

Rules:
- Return a complete <svg> element with viewBox="0 0 24 24".
- Use only basic shapes (path, circle, rect, line, polyline) — no filters, masks, or text.
- Single-color icon using currentColor (no hard-coded fill colors inside paths).
- Keep it clean and readable at 24px — think app icon, not illustration.
- tint: a soft pastel hex background that complements the topic (e.g. #EEF0FF, #E8F7EF, #F4EAFE).
- Match the icon metaphor to the subject (e.g. rocket for fast-track, brain for memory, code brackets for programming).`;
}

export function defaultGoalIconSvg(): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
}
