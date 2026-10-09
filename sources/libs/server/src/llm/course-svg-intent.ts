import { z } from "zod";
import { stripInternalLearningTargetRefs } from "./learner-facing-text.js";

export const COURSE_SVG_VISUAL_KINDS = [
  "simple_structure",
  "spatial_relationship",
  "state_comparison",
  "step_derivation",
] as const;

export type CourseSvgVisualKind = (typeof COURSE_SVG_VISUAL_KINDS)[number];

export const STATIC_COURSE_SVG_VISUAL_KINDS = [
  "simple_structure",
  "spatial_relationship",
  "state_comparison",
] as const satisfies readonly CourseSvgVisualKind[];

export function isAnimatedCourseSvgVisualKind(
  visualKind: CourseSvgVisualKind,
): boolean {
  return visualKind === "step_derivation";
}

const learnerText = (max: number) =>
  z.string().overwrite(stripInternalLearningTargetRefs).trim().min(1).max(max);

export const courseSvgBriefItemSchema = learnerText(400);
export const courseSvgBriefListSchema = z
  .array(courseSvgBriefItemSchema)
  .min(1)
  .max(12);

export const courseSvgIntentSchema = z.object({
  visualKind: z.enum(COURSE_SVG_VISUAL_KINDS),
  setup: learnerText(1_000),
  learningGoal: learnerText(1_000),
  expectedInsight: learnerText(1_000),
  /** Picture layout: reading order, relative placement, grouping, and flow. */
  composition: learnerText(2_000).optional(),
  elements: z.array(courseSvgBriefItemSchema).max(12).optional(),
  relationships: z.array(courseSvgBriefItemSchema).max(12).optional(),
  labels: z.array(courseSvgBriefItemSchema).max(12).optional(),
  avoid: z.array(courseSvgBriefItemSchema).max(12).optional(),
});

/** New material authoring must freeze a picture-level brief for stable redraws. */
export const courseSvgAuthoringIntentSchema = courseSvgIntentSchema.extend({
  composition: learnerText(2_000),
  elements: courseSvgBriefListSchema,
  relationships: courseSvgBriefListSchema,
  labels: courseSvgBriefListSchema,
  avoid: z.array(courseSvgBriefItemSchema).max(12).optional(),
});

export type CourseSvgIntent = z.infer<typeof courseSvgIntentSchema>;

export const COURSE_SVG_SLOT_INTENT_CONTRACT =
  '{"type":"svg_slot","intent":{"visualKind":"simple_structure","setup":"what this picture depicts","learningGoal":"the precise concept it should explain","expectedInsight":"what the learner should notice","composition":"how the picture is arranged: reading order, what sits left/right/above/below/center, how groups are clustered, and arrow or flow direction","elements":["required shape or object and where it sits"],"relationships":["how objects connect or compare, including direction"],"labels":["short visible label and its placement"],"avoid":["misconception or unsupported detail"]}}';

/**
 * Stable, human-readable serialization shared by the material and SVG calls.
 * Keep this brief deterministic so providers can reuse the same prefix while
 * the SVG request remains focused on the slot's semantic requirements.
 */
export function formatCourseSvgIntent(intent: CourseSvgIntent): string {
  const lines = [
    `Visual kind: ${intent.visualKind}`,
    `Setup: ${intent.setup}`,
    `Learning goal: ${intent.learningGoal}`,
    `Expected insight: ${intent.expectedInsight}`,
  ];
  if (intent.composition?.trim()) {
    lines.push(`Composition: ${intent.composition.trim()}`);
  }
  const optional = [
    ["Required elements", intent.elements],
    ["Relationships", intent.relationships],
    ["Visible labels", intent.labels],
    ["Avoid", intent.avoid],
  ] as const;
  for (const [label, values] of optional) {
    if (values?.length) lines.push(`${label}: ${values.join(" | ")}`);
  }
  return lines.join("\n");
}

function splitBriefList(value: string): string[] {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLabeledCourseSvgIntent(
  description: string,
): Partial<CourseSvgIntent> {
  const parsed: Partial<CourseSvgIntent> = {};
  for (const line of description.split("\n")) {
    const match = line.match(/^([^:]+):\s*(.*)$/u);
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    if (!value) continue;
    if (label === "Visual kind" && COURSE_SVG_VISUAL_KINDS.includes(value as CourseSvgVisualKind)) {
      parsed.visualKind = value as CourseSvgVisualKind;
    } else if (label === "Setup") parsed.setup = value;
    else if (label === "Learning goal") parsed.learningGoal = value;
    else if (label === "Expected insight") parsed.expectedInsight = value;
    else if (label === "Composition") parsed.composition = value;
    else if (label === "Required elements") parsed.elements = splitBriefList(value);
    else if (label === "Relationships") parsed.relationships = splitBriefList(value);
    else if (label === "Visible labels") parsed.labels = splitBriefList(value);
    else if (label === "Avoid") parsed.avoid = splitBriefList(value);
  }
  return parsed;
}

function parseLegacyCourseSvgIntent(
  description: string,
): Partial<CourseSvgIntent> {
  const visualKindMatch = description.match(
    /(?:^|\n)visualKind:\s*(simple_structure|spatial_relationship|state_comparison|step_derivation)(?:\n|$)/,
  );
  const learningGoal = description.match(/(?:^|\n)Learning goal:\s*(.*)$/m)?.[1]?.trim();
  const expectedInsight = description.match(
    /(?:^|\n)Expected insight:\s*(.*)$/m,
  )?.[1]?.trim();
  const setup = description
    .split("\n")
    .find(
      (line) =>
        line.trim() &&
        !/^(?:Learning goal|Expected insight|visualKind):/u.test(line.trim()),
    )
    ?.trim();
  return {
    ...(visualKindMatch?.[1]
      ? { visualKind: visualKindMatch[1] as CourseSvgVisualKind }
      : {}),
    ...(setup ? { setup } : {}),
    ...(learningGoal ? { learningGoal } : {}),
    ...(expectedInsight ? { expectedInsight } : {}),
  };
}

/** Rebuild a compiler brief from a stored placeholder or formatted intent. */
export function parseCourseSvgIntentFromDescription(
  description: string,
  fallback: CourseSvgIntent,
): CourseSvgIntent {
  const text = description.trim();
  if (!text) return fallback;
  const parsed = /^(?:Visual kind|Setup):/m.test(text)
    ? parseLabeledCourseSvgIntent(text)
    : parseLegacyCourseSvgIntent(description);
  const candidate = {
    visualKind: parsed.visualKind ?? fallback.visualKind,
    setup: parsed.setup || fallback.setup,
    learningGoal: parsed.learningGoal || fallback.learningGoal,
    expectedInsight: parsed.expectedInsight || fallback.expectedInsight,
    ...(parsed.composition ? { composition: parsed.composition } : {}),
    ...(parsed.elements?.length ? { elements: parsed.elements } : {}),
    ...(parsed.relationships?.length
      ? { relationships: parsed.relationships }
      : {}),
    ...(parsed.labels?.length ? { labels: parsed.labels } : {}),
    ...(parsed.avoid?.length ? { avoid: parsed.avoid } : {}),
  };
  const result = courseSvgIntentSchema.safeParse(candidate);
  return result.success ? result.data : fallback;
}

const UNSUITABLE_SVG_SUBJECT =
  /\b(?:anatom(?:y|ical)|animal|body|body\s*part|ear|eye|face|facial|finger|foot|hand|human|muscle|nose|organ|palm|person|portrait|skeleton|skin|thumb|toe|wrist)\b|(?:人体|身体部位|解剖|手部|左手|右手|手掌|手指|拇指|食指|中指|无名指|小指|五指|脸部|面部|眼睛|耳朵|鼻子|嘴巴|肌肉|骨骼|器官|动物)/iu;

/** Keep realistic and organic subjects out even if authoring misclassifies them. */
export function courseSvgIntentIssue(intent: CourseSvgIntent): string | null {
  const description = [
    intent.setup,
    intent.learningGoal,
    intent.expectedInsight,
    intent.composition ?? "",
    ...(intent.elements ?? []),
    ...(intent.relationships ?? []),
    ...(intent.labels ?? []),
  ].join(" ");
  if (UNSUITABLE_SVG_SUBJECT.test(description)) {
    return "subject requires an illustration or curated asset, not raw SVG";
  }
  return null;
}

export function attachCourseSvgIntent<T extends { type: string }>(
  block: T | null,
  intent: CourseSvgIntent,
): (T & { intent?: CourseSvgIntent }) | null {
  if (!block || block.type !== "svg") return block;
  return { ...block, intent };
}
