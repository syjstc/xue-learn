import { z } from "zod";
import {
  isQuantitativeTopicCategory,
  type TopicCategory,
} from "../../../common/src/index.js";
import {
  complexInteractiveBlockTypeSchema,
  generatableComplexInteractiveBlockTypeSchema,
  type ComplexInteractiveBlockType,
} from "./schemas.js";
import { stripInternalLearningTargetRefs } from "./learner-facing-text.js";

export const componentCategoryIdSchema = z.enum([
  "base",
  "math_visualization",
  // Legacy stored category. New selections are canonicalized to
  // math_visualization before validation.
  "data_visualization",
  "mechanics_lab",
  "circuit_lab",
  "chemistry_lab",
]);

export type ComponentCategoryId = z.infer<typeof componentCategoryIdSchema>;

/**
 * Most course sections need only base teaching blocks. The base family already
 * includes svg_slot, so visual explanations do not need a default category.
 */
export const GENERAL_INTERACTIVE_CATEGORIES: readonly ComponentCategoryId[] = [];

export const STANDARD_INTERACTIVE_CATEGORIES = GENERAL_INTERACTIVE_CATEGORIES;

/** Optional category for genuine coordinate-based mathematical interaction. */
export const SPECIALIZED_INTERACTIVE_CATEGORIES = [
  "math_visualization",
] as const satisfies readonly ComponentCategoryId[];

function isDomainComponentCategory(id: ComponentCategoryId): boolean {
  return Boolean(COMPONENT_CATEGORY_REGISTRY[id].topicCategories?.length);
}

function mergeBaseEnabledCategories(
  items: ComponentCategoryId[],
): ComponentCategoryId[] {
  return Array.from(new Set<ComponentCategoryId>(["base", ...items]));
}

const MAX_COMPONENT_SELECTION_RATIONALE_LENGTH = 240;

function truncateComponentSelectionRationale(value: string): string {
  if (value.length <= MAX_COMPONENT_SELECTION_RATIONALE_LENGTH) return value;
  const truncated = value.slice(0, MAX_COMPONENT_SELECTION_RATIONALE_LENGTH);
  // Avoid persisting an unmatched UTF-16 surrogate when the boundary lands
  // between the two code units of an astral character.
  return /[\uD800-\uDBFF]$/.test(truncated)
    ? truncated.slice(0, -1)
    : truncated;
}

export const componentCategorySelectionBaseSchema = z.object({
  mainCategory: componentCategoryIdSchema,
  enabledCategories: z
    .array(componentCategoryIdSchema)
    .min(1)
    .transform(mergeBaseEnabledCategories),
  // Rationale is cosmetic metadata. Normalize harmless model verbosity before
  // enforcing the canonical bound; overwrite() keeps maxLength in JSON Schema.
  rationale: z
    .string()
    .overwrite(truncateComponentSelectionRationale)
    .max(MAX_COMPONENT_SELECTION_RATIONALE_LENGTH)
    .optional(),
});

export const generatablePlannedComponentDraftSchema = z.object({
  componentType: generatableComplexInteractiveBlockTypeSchema,
  description: z
    .string()
    .overwrite(stripInternalLearningTargetRefs)
    .min(8)
    .max(2_000),
});

export type GeneratableMaterialComponentType = z.infer<
  typeof generatableComplexInteractiveBlockTypeSchema
>;

export const generatableMaterialComponentTypes =
  generatableComplexInteractiveBlockTypeSchema.options;

/** Stored/read path for planned complex components. */
export const plannedComponentDraftSchema = z.object({
  componentType: generatableComplexInteractiveBlockTypeSchema,
  description: z
    .string()
    .overwrite(stripInternalLearningTargetRefs)
    .min(8)
    .max(2_000),
});

export const plannedComponentSchema = plannedComponentDraftSchema.extend({
  id: z.string().regex(/^component_[1-8]$/),
});

/** Provider-facing selection; stable component ids are injected by the server. */
export const componentCategorySelectionBindingSchema =
  componentCategorySelectionBaseSchema.extend({
    plannedComponents: z.array(plannedComponentDraftSchema).max(8).optional(),
  });

/** Read compatibility for SQ previews created before material-owned intents. */
const legacyComponentCategorySelectionInputSchema =
  componentCategorySelectionBaseSchema.extend({
    plannedComponents: z
      .array(
        z.object({
          id: z.string().optional(),
          componentType: z.string(),
          description: z.string(),
        }),
      )
      .optional(),
  });

/** Canonical selection stored on SqPreview. */
export const componentCategorySelectionSchema =
  componentCategorySelectionBaseSchema.extend({
    plannedComponents: z.array(plannedComponentSchema).max(8).optional(),
  });

export type PlannedComponent = z.infer<typeof plannedComponentSchema>;
export type ComponentCategorySelection = z.infer<
  typeof componentCategorySelectionSchema
>;

export type MaterialGenerationPolicy = {
  allowedComponentTypes: ComplexInteractiveBlockType[];
  maxComponentCount: number;
  allowIllustrations: boolean;
  minIllustrationCount?: 0 | 1;
  maxIllustrationCount?: number;
  /** Desktop-dev 锐语腹黑: compile leftover svg/math_scene as illustrations. */
  replaceInLessonVisualsWithIllustrations?: boolean;
  plannedComponents?: PlannedComponent[];
};

/**
 * In-lesson teaching visuals. Charts are legacy read/compile support only;
 * new course content uses svg_slot for static explanations and keeps
 * math_scene as the exceptional renderer for genuine coordinate interaction.
 */
export const IN_LESSON_VISUAL_COMPONENT_TYPES =
  new Set<ComplexInteractiveBlockType>(["math_scene"]);

/** Safety cap only — prompts treat math scenes like SVG (no separate quota). */
export const MAX_IN_LESSON_VISUAL_COMPONENTS = 24;

/** Compiled interactives that belong in the optional unit lab, not the lesson. */
export const LAB_ACTIVITY_COMPONENT_TYPES =
  new Set<ComplexInteractiveBlockType>([
    "mechanics_sandbox",
    "circuit_sandbox",
    "chemistry_lab",
  ]);

/** @deprecated Use LAB_ACTIVITY_COMPONENT_TYPES; labs are no longer in-material sections. */
export const STANDALONE_SECTION_COMPONENT_TYPES = LAB_ACTIVITY_COMPONENT_TYPES;

export function isInLessonVisualComponentType(
  type: string,
): type is ComplexInteractiveBlockType {
  return IN_LESSON_VISUAL_COMPONENT_TYPES.has(
    type as ComplexInteractiveBlockType,
  );
}

export function isLabActivityComponentType(
  type: string,
): type is ComplexInteractiveBlockType {
  return LAB_ACTIVITY_COMPONENT_TYPES.has(type as ComplexInteractiveBlockType);
}

export function plannedInLessonVisualComponents(
  planned: readonly PlannedComponent[] | undefined,
): PlannedComponent[] {
  return (planned ?? []).filter((component) =>
    IN_LESSON_VISUAL_COMPONENT_TYPES.has(component.componentType),
  );
}

function plannedComponentAllowed(
  type: ComplexInteractiveBlockType,
  allowedTypes: Set<ComplexInteractiveBlockType>,
): boolean {
  return allowedTypes.has(type);
}

const COMPONENT_TYPES_BY_CATEGORY: Record<
  ComponentCategoryId,
  readonly ComplexInteractiveBlockType[]
> = {
  base: [],
  math_visualization: ["math_scene"],
  // Kept as a stored-category id for compatibility. Charts are intentionally
  // not part of the new course-content palette.
  data_visualization: [],
  mechanics_lab: ["mechanics_sandbox"],
  circuit_lab: ["circuit_sandbox"],
  chemistry_lab: ["chemistry_lab"],
};

type ComponentCategoryDefinition = {
  id: ComponentCategoryId;
  label: string;
  purpose: string;
  tags: string[];
  dslContract: string;
  topicCategories?: TopicCategory[];
  quantitativeOnly?: boolean;
};

const COMPONENT_DSL_FORMAT = `Describe each desired component as one intent line:
CI‖component_type‖natural-language description of the teaching interaction
Do not emit component JSON. Keep the description on one physical line and do not use "‖" inside it.`;

/** Shared authoring/selection rule: match the display to the teaching object; types are peers. */
export const VISUAL_RENDERER_PRIORITY_RULE = `Visual renderer matching: display types are peers — pick the board whose job matches this topic, not a preferred default. Callout for a definition, example, tip, or warning. Compare for side-by-side contrast. Accordion for optional extra detail. Conversation for a spoken exchange. Code for source or other monospace text. svg_slot for a schematic picture the learner should see (process flows, concept maps, static examples, physical ray/path diagrams, simple geometry constructions, simple quantitative comparisons, explanatory schematics); begin with a static picture, and add lightweight native SVG animation or interaction only when it directly improves the explanation. math_scene when a genuine coordinate plot—especially functions and vectors—or changing a parameter / dragging a mathematical object is the teaching object. Do not use math_scene merely because a schematic contains straight lines, arrows, points, geometric-looking objects, or crossing paths. Illustration (when enabled) when visible appearance, spatial context, concrete scenes or changes within them carry the explanation, including people, anatomy, organic forms and physical processes. A picture can be the main teaching evidence even when simple shapes could approximate the subject; do not replace useful visual evidence with prose or labeled boxes. Never skip a needed diagram to stay on text, and never add a decorative picture. Course content has no chart component: do not emit chart data or a chart block. Interactive HTML playgrounds and domain sandboxes belong in the unit lab, not the lesson.`;

const VISUAL_RENDERER_TYPE_GUIDE = `Web/Electron music is an ordinary authored display only when actual sound, notation or musical comparison is necessary evidence; it needs no CI entry or component quota. Music history and prose use ordinary displays. Matching in-lesson renderers: base/svg_slot for process flows, concept maps, static examples, physical ray/path diagrams, simple geometry constructions, simple quantitative comparisons, schematics, or completed derivation pictures; math_scene only for function graphs, vectors, quantitative coordinate plots, or mathematical parameter exploration. Course content does not emit chart components. Lab-only: mechanics_sandbox, circuit_sandbox, chemistry_lab, and interactive HTML playgrounds.`;

const BASE_DSL_CONTRACT = `Base components:
I‖intro text
H2‖heading
H3‖subheading
P‖paragraph
DEF‖title‖body
EX‖title‖body
TIP‖title‖body
WARN‖title‖body
Q‖question‖option1;option2[;option3...]‖correctIndex‖explanation
CMPL‖left label‖left point 1; left point 2
CMPR‖right label‖right point 1; right point 2
(For 3+ way comparisons, keep adjacent CMPL/CMPR lines together.)
ACC‖title‖body
K‖takeaway
Always-available teaching diagram (base component, like the former static SVG):
- svg_slot compiles to raw SVG markup — start with a schematic (simple_structure, spatial_relationship, state_comparison) or a completed derivation picture (step_derivation). Add lightweight native SVG animation or interaction only when it directly improves the teaching point. Do not invent a full experiment or a JSON element graph; multi-beat learner-driven diagrams belong in the unit lab HTML playground. Do not use svg_slot when math_scene is the matching renderer.
${COMPONENT_DSL_FORMAT}`;

const MECHANICS_LAB_DSL_CONTRACT = `Physics lab (enable for 物理 experiments the learner should run — kinematics/dynamics, not only when the word mechanics appears):
- mechanics_sandbox — interactive physics lab for 1D collisions/momentum, inclined plane, pendulum, or spring oscillators
Do not approximate these with math_scene or svg_slot. Do not enable this family for qualitative history of physics or for circuits.
${COMPONENT_DSL_FORMAT}`;

const CIRCUIT_LAB_DSL_CONTRACT = `Circuit lab (enable only for DC electrical circuits the learner should wire or measure):
- circuit_sandbox — interactive DC circuit lab composed from battery/resistor/rheostat/switch/bulb/ammeter/voltmeter in a series/parallel tree
Enable for Ohm's law, series/parallel networks, Kirchhoff loops, meters, and bulbs — including goals such as 复杂电路. Do not approximate these with svg_slot. Do not enable this family for digital logic, programming, or mechanics.
${COMPONENT_DSL_FORMAT}`;

const CHEMISTRY_LAB_DSL_CONTRACT = `Chemistry lab (enable for safe, certified virtual chemistry experiments):
- chemistry_lab — certified acid-base indicator, acid-base titration, precipitation, or mass-conservation experiment
Only use registered experiment templates. Do not emit reaction equations, arbitrary substances, executable code, free-form mixtures, or unsafe procedures. The chemistry lab is compiled after this lesson as 会学实验室.
${COMPONENT_DSL_FORMAT}`;

const MATH_VISUALIZATION_DSL_CONTRACT = `Mathematical visualization (only when the unit contains a relationship that must be inspected interactively):
- math_scene — a 2D/3D mathematical coordinate scene for static functions, coefficient sliders, draggable points/vectors/segments, live vector arithmetic, geometry, parametric/polar curves, or rotatable surfaces
Use math_scene only when coordinate position, shape, direction, intersection, or a mathematical function is itself part of the explanation. Use base/svg_slot for static quantitative comparisons and diagrams. Sequential geometric proofs stay in-lesson as a simple auto-play svg_slot; learner-driven multi-beat diagrams belong in the unit lab HTML playground. Do not emit chart components or chart data. Do not add math_scene when no coordinate relationship needs to be inspected.
${COMPONENT_DSL_FORMAT}`;

export const COMPONENT_CATEGORY_REGISTRY: Record<
  ComponentCategoryId,
  ComponentCategoryDefinition
> = {
  base: {
    id: "base",
    label: "core teaching",
    purpose:
      "General explanations, tips, comparisons, expandable notes, single-choice checks, and teaching diagrams. Diagrams are the always-on raw SVG base component (authored via svg_slot).",
    tags: [
      "I",
      "H2",
      "H3",
      "P",
      "DEF",
      "EX",
      "TIP",
      "WARN",
      "Q",
      "CMPL",
      "CMPR",
      "ACC",
      "K",
    ],
    dslContract: BASE_DSL_CONTRACT,
  },
  data_visualization: {
    id: "data_visualization",
    label: "legacy data visualization",
    purpose:
      "Legacy category retained for stored surveys; new course content uses math_visualization or base/svg_slot.",
    tags: [],
    dslContract: "Legacy category. Use math_visualization for coordinate-based mathematical interaction.",
  },
  math_visualization: {
    id: "math_visualization",
    label: "math visualization",
    purpose:
      "Mathematical coordinate scenes for functions, vectors, geometry, curves, or surfaces when coordinate interaction is essential; static comparisons use base/svg_slot.",
    tags: ["CI"],
    dslContract: MATH_VISUALIZATION_DSL_CONTRACT,
  },
  mechanics_lab: {
    id: "mechanics_lab",
    label: "physics lab",
    purpose:
      "Runnable physics (物理) experiments: kinematics/dynamics, collisions and momentum, inclined planes, pendulums, or spring oscillators.",
    tags: ["CI"],
    topicCategories: [
      "mathematics",
      "natural_science",
      "engineering",
      "professional",
      "general",
    ],
    dslContract: MECHANICS_LAB_DSL_CONTRACT,
  },
  circuit_lab: {
    id: "circuit_lab",
    label: "circuit lab",
    purpose:
      "Runnable DC circuit experiments: Ohm's law, series/parallel networks, Kirchhoff loops, switches, bulbs, and meters — including complex circuits.",
    tags: ["CI"],
    topicCategories: [
      "natural_science",
      "computer_science",
      "engineering",
      "professional",
      "general",
    ],
    dslContract: CIRCUIT_LAB_DSL_CONTRACT,
  },
  chemistry_lab: {
    id: "chemistry_lab",
    label: "chemistry lab",
    purpose:
      "Runnable certified chemistry experiments: acid-base indicators and titration, precipitation, and mass conservation.",
    tags: ["CI"],
    topicCategories: ["natural_science", "professional", "general"],
    dslContract: CHEMISTRY_LAB_DSL_CONTRACT,
  },
};

const COMPONENT_CATEGORY_SELECTION_WRAPPER_KEYS = [
  "componentSelection",
  "selection",
  "result",
  "data",
] as const;

const EXTRA_COMPONENT_CATEGORY_ALIASES: Record<string, ComponentCategoryId> = {
  text: "base",
  teaching: "base",
  core: "base",
  none: "base",
  markdown: "base",
  interactive: "base",
  process: "base",
  sequence: "base",
  flowchart: "base",
  data_visualization: "math_visualization",
  "data visualization": "math_visualization",
  visualization: "math_visualization",
  visual: "math_visualization",
  math: "math_visualization",
  math_visualization: "math_visualization",
  math_scene: "math_visualization",
  基础: "base",
  核心教学: "base",
  流程顺序: "base",
  过程顺序: "base",
  数据可视化: "math_visualization",
  数学可视化: "math_visualization",
  数学图形: "math_visualization",
  svg: "base",
  svg_slot: "base",
  mechanics: "mechanics_lab",
  physics: "mechanics_lab",
  physics_lab: "mechanics_lab",
  物理: "mechanics_lab",
  物理学: "mechanics_lab",
  物理实验: "mechanics_lab",
  物理沙箱: "mechanics_lab",
  力学实验: "mechanics_lab",
  力学沙箱: "mechanics_lab",
  circuit: "circuit_lab",
  electronics: "circuit_lab",
  电路: "circuit_lab",
  电路实验: "circuit_lab",
  电路沙箱: "circuit_lab",
  电学: "circuit_lab",
  chemistry: "chemistry_lab",
  chemistry_lab: "chemistry_lab",
  化学: "chemistry_lab",
  化学实验: "chemistry_lab",
  化学实验室: "chemistry_lab",
};

function addComponentCategoryAlias(
  aliases: Map<string, ComponentCategoryId>,
  alias: string,
  id: ComponentCategoryId,
): void {
  const trimmed = alias.trim();
  if (!trimmed) return;
  const lower = trimmed.toLowerCase();
  aliases.set(trimmed, id);
  aliases.set(lower, id);
  aliases.set(lower.replace(/[\s-]+/g, "_"), id);
  aliases.set(lower.replace(/[_-]+/g, " "), id);
}

function componentCategoryAliasMap(): Map<string, ComponentCategoryId> {
  const aliases = new Map<string, ComponentCategoryId>();
  for (const id of componentCategoryIdSchema.options) {
    addComponentCategoryAlias(aliases, id, id);
    addComponentCategoryAlias(
      aliases,
      COMPONENT_CATEGORY_REGISTRY[id].label,
      id,
    );
  }
  for (const [category, types] of Object.entries(COMPONENT_TYPES_BY_CATEGORY)) {
    for (const type of types) {
      addComponentCategoryAlias(aliases, type, category as ComponentCategoryId);
    }
  }
  for (const [alias, id] of Object.entries(EXTRA_COMPONENT_CATEGORY_ALIASES)) {
    addComponentCategoryAlias(aliases, alias, id);
  }
  return aliases;
}

function unwrapComponentCategorySelectionObject(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if ("mainCategory" in source || "enabledCategories" in source) return source;
  for (const key of COMPONENT_CATEGORY_SELECTION_WRAPPER_KEYS) {
    const nested = unwrapComponentCategorySelectionObject(source[key]);
    if (nested) return nested;
  }
  return source;
}

function canonicalizeComponentCategoryId(
  value: unknown,
  aliases = componentCategoryAliasMap(),
): ComponentCategoryId | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const direct = aliases.get(trimmed) ?? aliases.get(trimmed.toLowerCase());
    if (direct) return direct;
    const beforeParen = trimmed.split("(")[0]?.trim() ?? "";
    if (beforeParen && beforeParen !== trimmed) {
      const fromLabel =
        aliases.get(beforeParen) ?? aliases.get(beforeParen.toLowerCase());
      if (fromLabel) return fromLabel;
    }
    const ids = [...componentCategoryIdSchema.options].sort(
      (left, right) => right.length - left.length,
    );
    for (const id of ids) {
      if (new RegExp(`(?:^|[^a-z_])${id}(?:$|[^a-z_])`, "i").test(trimmed)) {
        return id;
      }
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const mapped = canonicalizeComponentCategoryId(item, aliases);
      if (mapped) return mapped;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  return canonicalizeComponentCategoryId(
    source.id ?? source.value ?? source.mainCategory ?? source.category,
    aliases,
  );
}

function canonicalizeComponentCategoryList(
  value: unknown,
  aliases = componentCategoryAliasMap(),
): ComponentCategoryId[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string" || (value && typeof value === "object")
      ? [value]
      : [];
  return [
    ...new Set(
      items.flatMap((item) => {
        const mapped = canonicalizeComponentCategoryId(item, aliases);
        return mapped ? [mapped] : [];
      }),
    ),
  ];
}

/**
 * MiniMax and other OpenAI-compatible endpoints often return catalog labels,
 * component type ids, or omit enabledCategories even when the tool schema is
 * present. Canonicalize those payloads before authoritative Zod validation.
 */
export function normalizeComponentCategorySelectionInput(
  value: unknown,
): unknown {
  const source = unwrapComponentCategorySelectionObject(value);
  if (!source) return value;
  const aliases = componentCategoryAliasMap();
  const enabledCategories = canonicalizeComponentCategoryList(
    source.enabledCategories,
    aliases,
  );
  const mainCategory =
    canonicalizeComponentCategoryId(source.mainCategory, aliases) ??
    enabledCategories.find((id) => id !== "base") ??
    enabledCategories[0];
  if (!mainCategory) return value;
  return {
    mainCategory,
    enabledCategories:
      enabledCategories.length > 0 ? enabledCategories : [mainCategory],
    ...(Array.isArray(source.plannedComponents)
      ? { plannedComponents: source.plannedComponents }
      : {}),
    ...(typeof source.rationale === "string"
      ? { rationale: source.rationale }
      : {}),
  };
}

/** Compact model-response schema for unit.component_category_selection. */
export const componentCategorySelectionResponseSchema = z.preprocess(
  normalizeComponentCategorySelectionInput,
  componentCategorySelectionBaseSchema,
);

export const DEFAULT_COMPONENT_SELECTION: ComponentCategorySelection = {
  mainCategory: "base",
  enabledCategories: ["base"],
};

export function defaultComponentSelectionForTopic(
  topicCategory: TopicCategory,
): ComponentCategorySelection {
  // Quantitative topics still default to base: SVG can cover ordinary visual
  // explanations, while ensureRequiredMathCategory opts into math_scene only
  // when the lesson genuinely needs coordinate interaction.
  void topicCategory;
  const enabledCategories = mergeBaseEnabledCategories([
    ...STANDARD_INTERACTIVE_CATEGORIES,
  ]);
  return {
    mainCategory: "base",
    enabledCategories,
  };
}

export function componentCategoryCatalogPrompt(
  topicCategory?: TopicCategory,
): string {
  const generalLines = GENERAL_INTERACTIVE_CATEGORIES.map(
    (id) =>
      `- ${id} (${COMPONENT_CATEGORY_REGISTRY[id].label}): ${COMPONENT_CATEGORY_REGISTRY[id].purpose}`,
  ).join("\n");
  const domainLines = (
    Object.values(COMPONENT_CATEGORY_REGISTRY) as ComponentCategoryDefinition[]
  )
    .filter(
      (category) =>
        category.topicCategories &&
        (!topicCategory || category.topicCategories.includes(topicCategory)),
    )
    .map(
      (category) => `- ${category.id} (${category.label}): ${category.purpose}`,
    )
    .join("\n");
  const specializedLines = SPECIALIZED_INTERACTIVE_CATEGORIES.map(
    (id) =>
      `- ${id} (${COMPONENT_CATEGORY_REGISTRY[id].label}): ${COMPONENT_CATEGORY_REGISTRY[id].purpose}`,
  ).join("\n");
  const quantitativeNote = isQuantitativeTopicCategory(topicCategory)
    ? "This goal is quantitative, but keep the course-content selection at base unless a genuine coordinate interaction is essential. Use svg_slot for static relationships and simple quantitative comparisons; do not emit chart components. Physics, circuit, and chemistry labs are domain extensions below; enable the matching lab instead of approximating an experiment with svg_slot."
    : "This goal is not classified as quantitative. Keep base and use svg_slot for process flows, concept maps, and static visual explanations. Only enable math_visualization for a genuine coordinate interaction; do not emit chart components. If a domain lab is listed below and this unit is actually a physics, DC-circuit, or certified chemistry experiment, enable that lab.";
  return [
    VISUAL_RENDERER_PRIORITY_RULE,
    VISUAL_RENDERER_TYPE_GUIDE,
    "Always enabled: base (text, checks, comparisons, callouts, and raw SVG teaching diagrams authored via svg_slot).",
    generalLines
      ? [
          "",
          "General interactives (enable when the unit benefits from practice):",
          generalLines,
        ]
      : [],
    "",
    "Optional mathematical interaction (enable only when coordinate manipulation is essential):",
    specializedLines,
    "",
    quantitativeNote,
    domainLines
      ? [
          "",
          "Domain extensions (enable only when truly required):",
          domainLines,
        ]
      : [],
  ]
    .flat()
    .join("\n");
}

export function normalizeComponentSelection(
  value: unknown,
): ComponentCategorySelection {
  const parsed = legacyComponentCategorySelectionInputSchema.safeParse(
    normalizeComponentCategorySelectionInput(value),
  );
  if (!parsed.success) return DEFAULT_COMPONENT_SELECTION;
  const allowedTypes = new Set(
    parsed.data.enabledCategories.flatMap(
      (category) => COMPONENT_TYPES_BY_CATEGORY[category],
    ),
  );
  const plannedComponents = (parsed.data.plannedComponents ?? [])
    .flatMap((component) => {
      const candidate = plannedComponentDraftSchema.safeParse(component);
      return candidate.success ? [candidate.data] : [];
    })
    .filter((component) =>
      plannedComponentAllowed(component.componentType, allowedTypes),
    )
    .slice(0, 8)
    .map((component, index) => ({
      ...component,
      id: `component_${index + 1}` as const,
    }));
  const { plannedComponents: _legacyPlans, ...baseSelection } = parsed.data;
  return componentCategorySelectionSchema.parse({
    ...baseSelection,
    ...(plannedComponents.length > 0 ? { plannedComponents } : {}),
  });
}

export function normalizeComponentSelectionForTopic(
  value: unknown,
  topicCategory: TopicCategory,
): ComponentCategorySelection {
  const selection = normalizeComponentSelection(value);
  const enabledCategories = mergeBaseEnabledCategories(
    selection.enabledCategories.filter((id) => {
      if (id === "base") return false;
      if (isDomainComponentCategory(id)) {
        const allowed = COMPONENT_CATEGORY_REGISTRY[id].topicCategories;
        return Boolean(allowed?.includes(topicCategory));
      }
      return true;
    }),
  );
  // Missing selections are defaulted by componentSelectionFromSqJson. An
  // explicit base-only selection is authoritative; a selection whose only
  // requested extension was invalid for the topic falls back to topic defaults.
  const resolvedCategories =
    enabledCategories.length === 1 &&
    selection.enabledCategories.some((category) => category !== "base")
      ? defaultComponentSelectionForTopic(topicCategory).enabledCategories
      : enabledCategories;
  const mainCategory = resolvedCategories.includes(selection.mainCategory)
    ? selection.mainCategory
    : resolvedCategories.includes("circuit_lab")
      ? "circuit_lab"
      : resolvedCategories.includes("mechanics_lab")
        ? "mechanics_lab"
        : resolvedCategories.includes("math_visualization")
          ? "math_visualization"
          : "base";
  const allowedTypes = new Set(
    resolvedCategories.flatMap(
      (category) => COMPONENT_TYPES_BY_CATEGORY[category],
    ),
  );
  const maxComponentCount = 8;
  const plannedComponents = (selection.plannedComponents ?? [])
    .filter((component) =>
      plannedComponentAllowed(component.componentType, allowedTypes),
    )
    .slice(0, maxComponentCount)
    .map((component, index) => ({
      componentType: component.componentType,
      description: component.description,
      id: `component_${index + 1}` as const,
    }));
  const { plannedComponents: _legacyPlans, ...baseSelection } = selection;
  return {
    ...baseSelection,
    mainCategory,
    enabledCategories: resolvedCategories,
    ...(plannedComponents.length > 0 ? { plannedComponents } : {}),
  };
}

/** Removes admin-disabled types from new plans while preserving stored render support. */
export function applyMaterialComponentAvailability(
  selection: ComponentCategorySelection,
  disabledTypes: readonly string[],
): ComponentCategorySelection {
  const disabled = new Set(disabledTypes);
  const dropMathVisualization = disabled.has("math_scene");
  const enabledCategories = dropMathVisualization
    ? mergeBaseEnabledCategories(
        selection.enabledCategories.filter(
          (category) => category !== "math_visualization",
        ),
      )
    : selection.enabledCategories;
  const mainCategory =
    dropMathVisualization && selection.mainCategory === "math_visualization"
      ? "base"
      : enabledCategories.includes(selection.mainCategory)
        ? selection.mainCategory
        : selection.mainCategory;
  const plannedComponents = (selection.plannedComponents ?? [])
    .filter((component) => !disabled.has(component.componentType))
    .map((component, index) => ({
      ...component,
      id: `component_${index + 1}` as const,
    }));
  const { plannedComponents: _legacyPlans, ...baseSelection } = selection;
  return {
    ...baseSelection,
    mainCategory,
    enabledCategories,
    ...(plannedComponents.length > 0 ? { plannedComponents } : {}),
  };
}

export function hasStoredComponentSelection(sqJson: string): boolean {
  try {
    const root = JSON.parse(sqJson) as Record<string, unknown>;
    const selection = root.componentSelection ?? root.component_selection;
    return componentCategorySelectionSchema.safeParse(selection).success;
  } catch {
    return false;
  }
}

export function hasStoredComponentPlan(sqJson: string): boolean {
  try {
    const root = JSON.parse(sqJson) as Record<string, unknown>;
    const selection = (root.componentSelection ?? root.component_selection) as
      Record<string, unknown> | undefined;
    return Boolean(
      selection &&
      Object.prototype.hasOwnProperty.call(selection, "plannedComponents") &&
      componentCategorySelectionSchema.safeParse(selection).success,
    );
  } catch {
    return false;
  }
}

export function componentDslContext(
  selection: ComponentCategorySelection,
): string {
  return selection.enabledCategories
    .map((id) => COMPONENT_CATEGORY_REGISTRY[id]?.dslContract)
    .filter(Boolean)
    .join("\n\n");
}

const COMPONENT_TYPE_AUTHORING_HINT: Partial<
  Record<ComplexInteractiveBlockType, string>
> = {
  chart: "measured or computed tabular data; never invent observations",
  math_scene: "functions, vectors, geometry, or coordinate plots",
  mechanics_sandbox:
    "runnable physics kinematics/dynamics lab; never replace with svg_slot",
  circuit_sandbox:
    "runnable DC circuit lab from a nested series/parallel tree; never replace with svg_slot",
  chemistry_lab:
    "runnable certified chemistry lab; choose only a registered experiment template and never emit arbitrary reactions",
};

/** Compact JSON-authoring guide. Omits legacy CI‖ DSL so material calls can attend to matching renderers. */
export function matchingRendererAuthoringGuide(
  selection: ComponentCategorySelection,
  allowedComponentTypes: readonly ComplexInteractiveBlockType[] = selection.enabledCategories.flatMap(
    (category) => [...COMPONENT_TYPES_BY_CATEGORY[category]],
  ),
): string {
  const allowed = new Set(
    allowedComponentTypes.filter((type) =>
      IN_LESSON_VISUAL_COMPONENT_TYPES.has(type),
    ),
  );
  const plannedVisualTypes = (selection.plannedComponents ?? [])
    .map((component) => component.componentType)
    .filter((type) => IN_LESSON_VISUAL_COMPONENT_TYPES.has(type));
  const types = Array.from(
    new Set(
      plannedVisualTypes.length > 0
        ? plannedVisualTypes.filter((type) => allowed.has(type))
        : [...allowed],
    ),
  );
  const lines = types.map((type) => {
    const hint = COMPONENT_TYPE_AUTHORING_HINT[type];
    return hint ? `- ${type} — ${hint}` : `- ${type}`;
  });
  const labNotes: string[] = [];
  if (selection.enabledCategories.includes("circuit_lab")) {
    labNotes.push(
      "circuit_sandbox is compiled after this lesson as 会学实验室. Teach the supporting DC-circuit prose here; do not draw the working circuit as svg_slot.",
    );
  }
  if (selection.enabledCategories.includes("mechanics_lab")) {
    labNotes.push(
      "mechanics_sandbox is compiled after this lesson as 会学实验室. Do not replace that lab with math_scene or svg_slot.",
    );
  }
  if (selection.enabledCategories.includes("chemistry_lab")) {
    labNotes.push(
      "chemistry_lab is compiled after this lesson as 会学实验室 from a certified template. Do not emit arbitrary reaction rules or substances.",
    );
  }
  if (types.length === 0 && labNotes.length === 0) return "";
  const visualBlock =
    types.length > 0
      ? `Matching in-lesson visuals (math_scene only; use as many distinct useful displays as the section needs):\n${lines.join("\n")}`
      : "";
  const labBlock =
    labNotes.length > 0
      ? `Lab families (compiled after the lesson, not as course blocks):\n${labNotes.join("\n")}`
      : "";
  return [visualBlock, labBlock].filter(Boolean).join("\n");
}

export function componentSelectionFromSqJson(
  sqJson: string,
  topicCategory?: TopicCategory,
): ComponentCategorySelection {
  try {
    const root = JSON.parse(sqJson) as Record<string, unknown>;
    const value = root.componentSelection ?? root.component_selection;
    if (value == null) {
      return topicCategory
        ? defaultComponentSelectionForTopic(topicCategory)
        : DEFAULT_COMPONENT_SELECTION;
    }
    return topicCategory
      ? normalizeComponentSelectionForTopic(value, topicCategory)
      : normalizeComponentSelection(value);
  } catch {
    return topicCategory
      ? defaultComponentSelectionForTopic(topicCategory)
      : DEFAULT_COMPONENT_SELECTION;
  }
}

export function materialGenerationPolicyFromSelection(
  selection: ComponentCategorySelection,
  topicCategory: TopicCategory | undefined,
  allowIllustrations: boolean,
  disabledComponentTypes: readonly string[] = [],
  options?: {
    maxIllustrationCount?: number;
    minIllustrationCount?: 0 | 1;
    replaceInLessonVisualsWithIllustrations?: boolean;
  },
): MaterialGenerationPolicy {
  const disabledTypes = new Set(disabledComponentTypes);
  const allowedComponentTypes = Array.from(
    new Set(
      selection.enabledCategories.flatMap(
        (category) => COMPONENT_TYPES_BY_CATEGORY[category],
      ),
    ),
  ).filter(
    (componentType) =>
      !disabledTypes.has(componentType) &&
      IN_LESSON_VISUAL_COMPONENT_TYPES.has(componentType),
  );
  const plannedComponents = plannedInLessonVisualComponents(
    selection.plannedComponents,
  ).filter((component) => !disabledTypes.has(component.componentType));
  return {
    allowedComponentTypes,
    maxComponentCount:
      allowedComponentTypes.length === 0 ? 0 : MAX_IN_LESSON_VISUAL_COMPONENTS,
    allowIllustrations,
    minIllustrationCount: options?.minIllustrationCount ?? 0,
    maxIllustrationCount: options?.maxIllustrationCount,
    ...(options?.replaceInLessonVisualsWithIllustrations
      ? { replaceInLessonVisualsWithIllustrations: true }
      : {}),
    plannedComponents,
  };
}

export function materialGenerationPolicyFromSqJson(
  sqJson: string,
  topicCategory: TopicCategory | undefined,
  allowIllustrations: boolean,
): MaterialGenerationPolicy {
  return materialGenerationPolicyFromSelection(
    componentSelectionFromSqJson(sqJson, topicCategory),
    topicCategory,
    allowIllustrations,
  );
}

export function interactiveComponentGuidance(
  selection: ComponentCategorySelection,
  topicCategory?: TopicCategory,
): string {
  const policy = materialGenerationPolicyFromSelection(
    selection,
    topicCategory,
    false,
  );
  if (policy.allowedComponentTypes.length === 0) {
    return "Use only base teaching blocks and svg_slot diagrams in the lesson; lab families compile after the lesson as 会学实验室.";
  }
  const allowed = policy.allowedComponentTypes.join(", ");
  return `In-lesson visuals (${allowed}) may appear as often as they help the explanation; there is no separate count quota beyond the overall material block bound. Do not emit lab types in the lesson.`;
}
