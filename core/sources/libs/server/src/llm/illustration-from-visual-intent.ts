import {
  formatCourseSvgIntent,
  type CourseSvgIntent,
} from "./course-svg-intent.js";

const ILLUSTRATION_STYLES = [
  "diagram",
  "process",
  "concept",
  "comparison",
] as const;

type IllustrationStyle = (typeof ILLUSTRATION_STYLES)[number];

export type AuthoredIllustrationWire = {
  type: "illustration";
  caption: string;
  prompt: string;
  style: IllustrationStyle;
  aspectRatio: "16:9";
};

type TeachingVisualIntent = {
  setup?: unknown;
  learningGoal?: unknown;
  expectedInsight?: unknown;
  composition?: unknown;
  elements?: unknown;
  relationships?: unknown;
  labels?: unknown;
  visualKind?: unknown;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = asText(item);
        return text ? [text] : [];
      })
    : [];
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function illustrationStyleFromVisualKind(visualKind: unknown): IllustrationStyle {
  if (visualKind === "step_derivation") return "process";
  if (visualKind === "state_comparison") return "comparison";
  if (visualKind === "simple_structure") return "concept";
  return "diagram";
}

function promptFromTeachingIntent(intent: TeachingVisualIntent): string {
  const svgLike: CourseSvgIntent | null =
    intent.visualKind === "simple_structure" ||
    intent.visualKind === "spatial_relationship" ||
    intent.visualKind === "state_comparison" ||
    intent.visualKind === "step_derivation"
      ? {
          visualKind: intent.visualKind,
          setup: asText(intent.setup) || "Teaching visual",
          learningGoal: asText(intent.learningGoal) || "Explain the relationship",
          expectedInsight:
            asText(intent.expectedInsight) || "Notice the core relationship",
          ...(asText(intent.composition)
            ? { composition: asText(intent.composition) }
            : {}),
          ...(asList(intent.elements).length
            ? { elements: asList(intent.elements) }
            : {}),
          ...(asList(intent.relationships).length
            ? { relationships: asList(intent.relationships) }
            : {}),
          ...(asList(intent.labels).length
            ? { labels: asList(intent.labels) }
            : {}),
        }
      : null;
  if (svgLike) {
    return `${formatCourseSvgIntent(svgLike)}\nDo NOT specify colors, backgrounds, frames, or art style.`;
  }
  const lines = [
    `Subject: ${asText(intent.setup) || "Teaching visual"}`,
    `Learning goal: ${asText(intent.learningGoal) || "Explain the relationship"}`,
    `Expected insight: ${asText(intent.expectedInsight) || "Notice the core relationship"}`,
  ];
  if (asText(intent.composition)) {
    lines.push(`Composition: ${asText(intent.composition)}`);
  }
  if (asList(intent.elements).length) {
    lines.push(`Required elements: ${asList(intent.elements).join(" | ")}`);
  }
  if (asList(intent.relationships).length) {
    lines.push(`Relationships: ${asList(intent.relationships).join(" | ")}`);
  }
  if (asList(intent.labels).length) {
    lines.push(`Labels: ${asList(intent.labels).join(" | ")}`);
  }
  lines.push("Do NOT specify colors, backgrounds, frames, or art style.");
  return lines.join("\n");
}

export function illustrationWireFromTeachingIntent(
  intent: TeachingVisualIntent | undefined,
  options?: { caption?: string; style?: IllustrationStyle },
): AuthoredIllustrationWire {
  const safeIntent = intent ?? {};
  const caption =
    firstNonEmpty(
      options?.caption,
      safeIntent.learningGoal,
      safeIntent.setup,
      safeIntent.expectedInsight,
    ) || "Teaching visual";
  return {
    type: "illustration",
    caption,
    prompt: promptFromTeachingIntent(safeIntent),
    style: options?.style ?? illustrationStyleFromVisualKind(safeIntent.visualKind),
    aspectRatio: "16:9",
  };
}

function recordIntent(value: unknown): TeachingVisualIntent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as TeachingVisualIntent;
}

function rewriteStageFigures(figures: unknown): unknown {
  if (!Array.isArray(figures)) return figures;
  return figures.map((figure) => rewriteInLessonVisualWireItemToIllustration(figure));
}

/**
 * Fail-open: leftover svg_slot / math_scene authoring becomes a raster
 * illustration instead of compiling an interactive scene.
 */
export function rewriteInLessonVisualWireItemToIllustration(
  value: unknown,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;

  if (record.kind === "block" && record.block) {
    return {
      ...record,
      block: rewriteInLessonVisualWireItemToIllustration(record.block),
    };
  }

  if (record.type === "stage") {
    return {
      ...record,
      figures: rewriteStageFigures(record.figures),
    };
  }

  if (record.kind === "svg_ref" || record.type === "svg_slot") {
    const illustration = illustrationWireFromTeachingIntent(
      recordIntent(record.intent),
    );
    return record.kind === "svg_ref"
      ? { kind: "block", block: illustration }
      : illustration;
  }

  const componentType =
    typeof record.componentType === "string" ? record.componentType : "";
  const isMathSceneWire =
    record.type === "math_scene" ||
    componentType === "math_scene" ||
    (record.kind === "component_intent" && componentType === "math_scene") ||
    (record.kind === "component_ref" && componentType === "math_scene");
  if (isMathSceneWire) {
    const illustration = illustrationWireFromTeachingIntent(
      recordIntent(record.intent ?? record),
      { style: "diagram" },
    );
    return record.kind === "component_intent" || record.kind === "component_ref"
      ? { kind: "block", block: illustration }
      : illustration;
  }

  return value;
}
