import type {RemotionMotionSceneComponent} from "./motion-scene-schema.js";
/** Independent film data. Motion scenes allow bounded canvas geometry, never
 * page CSS, executable code, wall-clock durations or arbitrary resource URLs. */
export const REMOTION_LESSON_SCHEMA_VERSION = 1 as const;

export const REMOTION_LESSON_COMPONENT_TYPES = [
  "title.v1", "cards.v1", "compare.v1", "formula.v1", "code.v1",
  "concept-network.v1", "process.v1", "animated-chart.v1",
  "spatial-assembly.v1", "lottie-explainer.v1", "image.v1",
  "occlusion-lab.v1",
  "evaluation-lab.v1",
  "motion-scene.v1",
  "teaching-template.v1",
  "display.v1",
] as const;
export type RemotionLessonComponentType = (typeof REMOTION_LESSON_COMPONENT_TYPES)[number];

export const REMOTION_LESSON_ACTIONS = [
  "overview", "reveal", "focus", "connect", "transform", "assemble", "separate", "play",
] as const;
export type RemotionLessonAction = (typeof REMOTION_LESSON_ACTIONS)[number];

/** Renderer-owned presets; the document can never specify a Lottie URL/JSON. */
export const REMOTION_LOTTIE_PRESETS = ["signal-flow", "orbit-cycle", "balance-shift"] as const;
export type RemotionLottiePreset = (typeof REMOTION_LOTTIE_PRESETS)[number];
export const REMOTION_SPATIAL_PRIMITIVES = ["box", "sphere", "cylinder", "cone"] as const;
export const REMOTION_SEMANTIC_TONES = ["primary", "secondary", "accent", "muted"] as const;
export const REMOTION_CODE_LANGUAGES = [
  "text", "javascript", "typescript", "python", "sql", "json", "html", "css", "java", "c", "cpp", "shell",
] as const;

export type RemotionLessonLabel = Readonly<{ id: string; label: string }>;
export type RemotionLessonItem = Readonly<{ id: string; label: string; detail?: string }>;
export type RemotionLessonPoint = Readonly<{ id: string; text: string }>;

export type RemotionTitleComponent = Readonly<{
  type: "title.v1";
  props: Readonly<{ headline: string; eyebrow?: string; subtitle?: string; keywords: readonly RemotionLessonLabel[] }>;
}>;
export type RemotionCardsComponent = Readonly<{
  type: "cards.v1";
  props: Readonly<{ title?:string; layout: "grid" | "stack"; items: readonly RemotionLessonItem[] }>;
}>;
export type RemotionCompareComponent = Readonly<{
  type: "compare.v1";
  props: Readonly<{
    sides?: readonly Readonly<{id:string;label:string;points:readonly RemotionLessonPoint[]}>[];
    left: Readonly<{ id: string; label: string; points: readonly RemotionLessonPoint[] }>;
    right: Readonly<{ id: string; label: string; points: readonly RemotionLessonPoint[] }>;
  }>;
}>;
export type RemotionFormulaComponent = Readonly<{
  type: "formula.v1";
  props: Readonly<{
    equations: readonly Readonly<{ id: string; latex: string; label?: string }>[];
    notes: readonly RemotionLessonPoint[];
  }>;
}>;
export type RemotionCodeComponent = Readonly<{
  type: "code.v1";
  props: Readonly<{
    language: (typeof REMOTION_CODE_LANGUAGES)[number];
    code: string;
    /** One-based inclusive original source lines; wrapping does not change IDs. */
    highlights: readonly Readonly<{ id: string; label: string; startLine: number; endLine: number }>[];
  }>;
}>;
export type RemotionConceptNetworkComponent = Readonly<{
  type: "concept-network.v1";
  props: Readonly<{
    nodes: readonly RemotionLessonItem[];
    edges: readonly Readonly<{ id: string; from: string; to: string; label?: string }>[];
  }>;
}>;
export type RemotionProcessComponent = Readonly<{
  type: "process.v1";
  props: Readonly<{ title?:string; direction: "linear" | "cycle"; steps: readonly RemotionLessonItem[] }>;
}>;
export type RemotionAnimatedChartComponent = Readonly<{
  type: "animated-chart.v1";
  props: Readonly<{
    chart: "bar" | "line" | "donut";
    unit: string;
    categories: readonly (RemotionLessonLabel & {detail?:string})[];
    /** Each series supplies one finite number per category, in category order. */
    series: readonly Readonly<{ id: string; label: string; values: readonly number[] }>[];
  }>;
}>;
export type RemotionSpatialAssemblyComponent = Readonly<{
  type: "spatial-assembly.v1";
  props: Readonly<{
    layout: "row" | "stack" | "orbit";
    parts: readonly Readonly<{
      id: string;
      label: string;
      primitive: (typeof REMOTION_SPATIAL_PRIMITIVES)[number];
      tone: (typeof REMOTION_SEMANTIC_TONES)[number];
    }>[];
    caption: string;
  }>;
}>;
export type RemotionLottieExplainerComponent = Readonly<{
  type: "lottie-explainer.v1";
  props: Readonly<{ preset: RemotionLottiePreset; items: readonly RemotionLessonItem[]; caption: string }>;
}>;

export type RemotionImageComponent = Readonly<{
  type: "image.v1";
  props: Readonly<{ id: string; prompt: string; alt: string; caption: string;
    motion?: "still" | "push-in" | "pull-out" | "pan-left" | "pan-right";
    /** Filled only by the host after generation into owned immutable storage. */
    src?: string;
    /** The author identifies teachable subjects, never coordinates or timing. */
    regionIntents?: readonly Readonly<{id: string; label: string; description: string}>[];
    /** Host observation is registered to this exact immutable source image. */
    guidedImage?: Readonly<{sha256: string; width: number; height: number;
      segmentation: import("../../../../libs/domain/src/guided-image.js").GuidedImageSegmentation;
    }>;
  }>;
}>;

/** A bounded, executable experiment, not arbitrary object motion. Positions are
 * one-based cells; both cases always receive the same signed displacement. */
export type RemotionOcclusionLabComponent = Readonly<{
  type: "occlusion-lab.v1";
  props: Readonly<{
    cells: number;
    wall: Readonly<{ from: number; to: number }>;
    moveBy: number;
    cases: readonly Readonly<{ id: string; label: string; initialCell: number }>[];
    stages: readonly Readonly<{ id: string; label: string; view: "observation" | "cutaway"; moved: boolean }>[];
  }>;
}>;

export type RemotionEvaluationLabComponent = Readonly<{
  type: "evaluation-lab.v1";
  props: Readonly<{
    caption: string;
    cases: readonly Readonly<{id: string; label: string}>[];
    runs: readonly Readonly<{id: string; label: string; outcomes: readonly Readonly<{
      caseId: string; verdict: "pass" | "fail" | "critical"; note: string;
    }>[]}>[];
  }>;
}>;

export type RemotionLessonComponent =
  | RemotionTitleComponent | RemotionCardsComponent | RemotionCompareComponent
  | RemotionFormulaComponent | RemotionCodeComponent | RemotionConceptNetworkComponent
  | RemotionProcessComponent | RemotionAnimatedChartComponent
  | RemotionSpatialAssemblyComponent | RemotionLottieExplainerComponent | RemotionImageComponent | RemotionOcclusionLabComponent | RemotionEvaluationLabComponent | RemotionMotionSceneComponent;

export type RemotionLessonBeatV1 = Readonly<{
  /** Globally unique across this document, including scene IDs. */
  id: string;
  /** The preserved source spoken line. Compilation never truncates or oralizes it. */
  text: string;
  /** Host-only pronunciation copy. The original text and visual cue stay intact. */
  speechText?: string;
  action: RemotionLessonAction;
  /** Scene-local IDs; overview uses [], other actions require known targets. */
  targetIds: readonly string[];
}>;
export type RemotionLessonSceneV1 = Readonly<{
  id: string;
  title: string;
  /** Host-owned course structure. Optional for preserved historical films. */
  role?: "opening" | "content" | "conclusion";
  component: Readonly<{type: string; props: unknown}>;
  beats: readonly RemotionLessonBeatV1[];
}>;
export type RemotionLessonDocumentV1 = Readonly<{
  schemaVersion: typeof REMOTION_LESSON_SCHEMA_VERSION;
  title: string;
  summary: string;
  scenes: readonly RemotionLessonSceneV1[];
}>;

export const REMOTION_COMPONENT_ACTIONS: Readonly<Record<RemotionLessonComponentType, readonly RemotionLessonAction[]>> = {
  "display.v1": ["overview", "focus", "transform", "play"],
  "teaching-template.v1": ["overview", "focus", "transform", "play"],
  "motion-scene.v1": ["overview", "focus", "transform"],
  "occlusion-lab.v1": ["overview", "focus", "transform"],
  "evaluation-lab.v1": ["overview", "play", "focus"],
  "image.v1": ["overview", "reveal", "focus"],
  "title.v1": ["overview", "reveal", "focus"],
  "cards.v1": ["overview", "reveal", "focus"],
  "compare.v1": ["overview", "reveal", "focus"],
  "formula.v1": ["overview", "reveal", "focus", "transform"],
  "code.v1": ["overview", "reveal", "focus"],
  "concept-network.v1": ["overview", "reveal", "focus", "connect"],
  "process.v1": ["overview", "reveal", "focus", "connect"],
  "animated-chart.v1": ["overview", "reveal", "focus", "transform"],
  "spatial-assembly.v1": ["overview", "reveal", "focus", "assemble", "separate"],
  "lottie-explainer.v1": ["overview", "reveal", "focus", "play"],
};
