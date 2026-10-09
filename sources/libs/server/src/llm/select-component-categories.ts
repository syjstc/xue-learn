import { type TopicCategory } from "../../../common/src/index.js";
import {
  applyMaterialComponentAvailability,
  componentSelectionFromSqJson,
  componentCategorySelectionBaseSchema,
  componentCategorySelectionResponseSchema,
  componentCategorySelectionSchema,
  defaultComponentSelectionForTopic,
  hasStoredComponentSelection,
  normalizeComponentSelectionForTopic,
  type ComponentCategorySelection,
} from "./component-dsl-registry.js";
import { getDisabledMaterialComponentTypes } from "./material-component-settings.js";
import {
  runValidatedStructuredGeneration,
  StructuredGenerationError,
} from "./validated-structured-generation.js";
import { buildMaterialComponentInvocationPrompt } from "../learning-systems/capabilities/material-components/capability.js";
import { MATERIAL_COMPONENT_VIEW_KEYS } from "../learning-systems/capabilities/material-components/keys.js";

function learningTargetsFromSqJson(sqJson: string): string {
  try {
    const root = JSON.parse(sqJson) as {
      learningTargets?: Array<Record<string, unknown>>;
    };
    return (root.learningTargets ?? [])
      .map((target) => {
        const id = typeof target.id === "string" ? target.id : "";
        const label = typeof target.label === "string" ? target.label : "";
        const objective =
          typeof target.learningObjective === "string"
            ? target.learningObjective
            : "";
        const criteria = Array.isArray(target.assessmentCriteria)
          ? target.assessmentCriteria
              .filter((item): item is string => typeof item === "string")
              .join("；")
          : "";
        return `${id}: ${label}; objective: ${objective}; criteria: ${criteria}`;
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

const MATH_SCENE_REQUIRED_PATTERN =
  /(?:函数.{0,8}(?:图像|图象|曲线)|(?:图像|图象).{0,8}函数|斜率|截距|坐标(?:系|轴|平面)|向量|抛物线|双曲线|渐近线|几何图形|function\s+(?:graph|curve)|graph\s+of\s+(?:a\s+)?function|slope|intercept|coordinate\s+(?:plane|system|axis)|vector|parabola|hyperbola|asymptote|parametric\s+curve|polar\s+(?:curve|function)|surface\s+z\s*=|\by\s*=\s*[^\n,，;；]{1,80}\bx\b|\bf\s*\(\s*x\s*\))/iu;

const CIRCUIT_LAB_REQUIRED_PATTERN =
  /(?:复杂电路|电路|欧姆定律|基尔霍夫|串并联|串联电路|并联电路|直流电路|交流电路|闭合电路|滑动变阻器|电学实验|节点电压|支路电流|ohm(?:['’]s)?\s+law|kirchhoff|dc\s+circuit|ac\s+circuit|series[- ]parallel|\bresistor\b|\bpotentiometer\b|\bvoltmeter\b|\bammeter\b|lightbulb|circuit\s+(?:lab|sandbox|simulation|experiment))/iu;

const MECHANICS_LAB_REQUIRED_PATTERN =
  /(?:物理(?:学|实验|沙箱|课)?|运动学|动力学|受力分析|自由落体|抛体|功和能|机械能|动量守恒|动能守恒|弹性碰撞|非弹性碰撞|刚体碰撞|斜面滑块|斜面|单摆|弹簧振子|简谐(?:运动|振动)|牛顿定律|力学实验|1[dD]\s+collision|elastic\s+collision|inclined\s+plane|pendulum|spring\s+oscillator|momentum\s+conservation|newton(?:['’]s)?\s+laws?|kinematics|dynamics|\bphysics\b)/iu;

const CHEMISTRY_LAB_REQUIRED_PATTERN =
  /(?:化学(?:实验|反应|滴定|沉淀|实验室)?|酸碱|指示剂|滴定|当量点|沉淀反应|质量守恒|硝酸银|氯化钠|chemical(?:\s+lab|\s+experiment)?|acid[- ]base|titration|precipitation|indicator|mass\s+conservation)/iu;

function teachingTextFromSelectionParams(
  params: Pick<
    Parameters<typeof selectComponentCategories>[0],
    "unitTitle" | "summary" | "context" | "learningTargets"
  >,
): string {
  return [
    params.unitTitle,
    params.summary,
    params.learningTargets ?? "",
    params.context,
  ].join("\n");
}

function enableRequiredCategory(
  selection: ComponentCategorySelection,
  category:
    | "math_visualization"
    | "circuit_lab"
    | "mechanics_lab"
    | "chemistry_lab",
  rationale: string,
): ComponentCategorySelection {
  return componentCategorySelectionSchema.parse({
    ...selection,
    mainCategory:
      selection.mainCategory === "base" ? category : selection.mainCategory,
    enabledCategories: Array.from(
      new Set([...selection.enabledCategories, category]),
    ),
    rationale: selection.rationale ?? rationale,
  });
}

function ensureRequiredMathCategory(
  selection: ComponentCategorySelection,
  params: Pick<
    Parameters<typeof selectComponentCategories>[0],
    "unitTitle" | "summary" | "context" | "learningTargets"
  >,
  disabledTypes: readonly string[],
): ComponentCategorySelection {
  const teachingText = teachingTextFromSelectionParams(params);
  if (!MATH_SCENE_REQUIRED_PATTERN.test(teachingText)) return selection;
  if (disabledTypes.includes("math_scene")) return selection;
  return enableRequiredCategory(
    selection,
    "math_visualization",
    "The core relationship must be inspected in a mathematical scene.",
  );
}

function withPlannedComponents(
  selection: ComponentCategorySelection,
  planned: NonNullable<ComponentCategorySelection["plannedComponents"]>,
): ComponentCategorySelection {
  const plannedComponents = planned.slice(0, 8).map((component, index) => ({
    componentType: component.componentType,
    description: component.description,
    id: `component_${index + 1}` as const,
  }));
  const { plannedComponents: _legacyPlans, ...baseSelection } = selection;
  return componentCategorySelectionSchema.parse({
    ...baseSelection,
    ...(plannedComponents.length > 0 ? { plannedComponents } : {}),
  });
}

function ensureRequiredLabCategories(
  selection: ComponentCategorySelection,
  params: Pick<
    Parameters<typeof selectComponentCategories>[0],
    "unitTitle" | "summary" | "context" | "learningTargets"
  >,
  disabledTypes: readonly string[],
): ComponentCategorySelection {
  const teachingText = teachingTextFromSelectionParams(params);
  let next = selection;
  if (
    CHEMISTRY_LAB_REQUIRED_PATTERN.test(teachingText) &&
    !disabledTypes.includes("chemistry_lab")
  ) {
    next = enableRequiredCategory(
      next,
      "chemistry_lab",
      "The unit teaches a certified chemistry experiment the learner should run.",
    );
  }
  if (
    CIRCUIT_LAB_REQUIRED_PATTERN.test(teachingText) &&
    !disabledTypes.includes("circuit_sandbox")
  ) {
    next = enableRequiredCategory(
      next,
      "circuit_lab",
      "The unit teaches a DC circuit the learner should experiment with.",
    );
  }
  if (
    MECHANICS_LAB_REQUIRED_PATTERN.test(teachingText) &&
    !disabledTypes.includes("mechanics_sandbox")
  ) {
    next = enableRequiredCategory(
      next,
      "mechanics_lab",
      "The unit teaches a physics experiment the learner should run.",
    );
  }
  return ensureRequiredMatchingLabPlans(next, params, disabledTypes);
}

/**
 * Lab families are unique matching renderers. Enabling circuit_lab without a
 * frozen circuit_sandbox slot left material authoring with an optional 0-N
 * palette, so the model often drew svg_slot instead. Server-own the slot.
 */
function ensureRequiredMatchingLabPlans(
  selection: ComponentCategorySelection,
  params: Pick<
    Parameters<typeof selectComponentCategories>[0],
    "unitTitle" | "summary" | "context" | "learningTargets"
  >,
  disabledTypes: readonly string[],
): ComponentCategorySelection {
  const teachingText = teachingTextFromSelectionParams(params);
  const planned = [...(selection.plannedComponents ?? [])];
  const addPlan = (
    componentType: "circuit_sandbox" | "mechanics_sandbox" | "chemistry_lab",
    description: string,
  ) => {
    if (disabledTypes.includes(componentType)) return;
    if (
      planned.some((component) => component.componentType === componentType)
    ) {
      return;
    }
    planned.push({
      componentType,
      description,
      id: `component_${planned.length + 1}` as const,
    });
  };
  if (
    selection.enabledCategories.includes("circuit_lab") &&
    CIRCUIT_LAB_REQUIRED_PATTERN.test(teachingText)
  ) {
    addPlan(
      "circuit_sandbox",
      `Interactive DC circuit the learner can wire and measure for “${params.unitTitle}”: vary a switch or resistance and observe current, voltage, or bulb brightness for this lesson's circuit relationship.`,
    );
  }
  if (
    selection.enabledCategories.includes("mechanics_lab") &&
    MECHANICS_LAB_REQUIRED_PATTERN.test(teachingText)
  ) {
    addPlan(
      "mechanics_sandbox",
      `Interactive physics lab the learner can run for “${params.unitTitle}”: change one initial condition and observe the kinematics or dynamics this lesson teaches.`,
    );
  }
  if (
    selection.enabledCategories.includes("chemistry_lab") &&
    CHEMISTRY_LAB_REQUIRED_PATTERN.test(teachingText)
  ) {
    addPlan(
      "chemistry_lab",
      `Certified chemistry lab for “${params.unitTitle}”: safely run an acid-base, precipitation, indicator, or mass-conservation experiment and observe its registered measurements.`,
    );
  }
  return withPlannedComponents(selection, planned);
}

/**
 * Survey-stage routing call. The result is stored on SqPreview and later limits
 * the DSL grammar exposed to the lesson-generation model.
 */
export async function selectComponentCategories(params: {
  unitTitle: string;
  summary: string;
  context: string;
  learningTargets?: string;
  topicCategory: TopicCategory;
  contextSubject: {
    userId?: string;
    goalId: string;
    unitId: string;
  };
  extraDisabledComponentTypes?: readonly string[];
  signal?: AbortSignal;
  authorSelection?: (input: {
    prompt: string;
    resultSchema: typeof componentCategorySelectionResponseSchema;
    contextInvocation: Record<string, unknown>;
  }) => Promise<ComponentCategorySelection>;
}): Promise<ComponentCategorySelection> {
  let disabledTypes: readonly string[] = [
    ...(params.extraDisabledComponentTypes ?? []),
  ];
  try {
    disabledTypes = [
      ...(await getDisabledMaterialComponentTypes()),
      ...(params.extraDisabledComponentTypes ?? []),
    ];
  } catch {
    // Component enhancement settings must not block authoritative SQ creation.
  }
  try {
    const promptInvocation = {
      ...params,
      disabledComponentTypes: disabledTypes,
    };
    const selectionPrompt =
      buildMaterialComponentInvocationPrompt(
        MATERIAL_COMPONENT_VIEW_KEYS.selectionInstructionContext,
        promptInvocation,
      ) ?? "";
    const rawSelection = params.authorSelection
      ? await params.authorSelection({
          prompt: selectionPrompt,
          resultSchema: componentCategorySelectionResponseSchema,
          contextInvocation: promptInvocation,
        })
      : await runValidatedStructuredGeneration(
          {
            mode: "object",
            schema: componentCategorySelectionResponseSchema,
            prompt: selectionPrompt,
            options: {
              operation: "unit.component_category_selection",
              bindingSchema: componentCategorySelectionBaseSchema,
              topicCategory: params.topicCategory,
              meta: {
                unitTitle: params.unitTitle,
                topicCategory: params.topicCategory,
                outputFormat: "structured_object",
              },
            },
            contextSubject: params.contextSubject,
            contextQuery: params.unitTitle.slice(0, 2_000),
            contextInvocation: promptInvocation,
          },
          { signal: params.signal },
        );
    const normalized = componentCategorySelectionSchema.parse(
      normalizeComponentSelectionForTopic(
        componentCategorySelectionResponseSchema.parse(rawSelection),
        params.topicCategory,
      ),
    );
    return applyMaterialComponentAvailability(
      ensureRequiredLabCategories(
        ensureRequiredMathCategory(normalized, params, disabledTypes),
        params,
        disabledTypes,
      ),
      disabledTypes,
    );
  } catch (error) {
    // Component planning is an optional material enhancement. A provider that
    // exhausts structured-output validation must not block the authoritative
    // SQ or prevent the learner from opening the unit.
    if (error instanceof StructuredGenerationError) {
      return applyMaterialComponentAvailability(
        ensureRequiredLabCategories(
          ensureRequiredMathCategory(
            defaultComponentSelectionForTopic(params.topicCategory),
            params,
            disabledTypes,
          ),
          params,
          disabledTypes,
        ),
        disabledTypes,
      );
    }
    throw error;
  }
}

/**
 * New SQ previews carry a compact category palette. Older previews without any
 * selection receive the same bounded routing call at material time.
 */
export async function resolveMaterialComponentSelection(params: {
  sqJson: string;
  unitTitle: string;
  summary: string;
  context: string;
  topicCategory: TopicCategory;
  contextSubject: {
    userId?: string;
    goalId: string;
    unitId: string;
  };
  extraDisabledComponentTypes?: readonly string[];
  signal?: AbortSignal;
}): Promise<ComponentCategorySelection> {
  if (hasStoredComponentSelection(params.sqJson)) {
    let disabledTypes: readonly string[] = [
      ...(params.extraDisabledComponentTypes ?? []),
    ];
    try {
      disabledTypes = [
        ...(await getDisabledMaterialComponentTypes()),
        ...(params.extraDisabledComponentTypes ?? []),
      ];
    } catch {
      // Existing optional enhancement behavior remains available on settings failure.
    }
    const stored = componentSelectionFromSqJson(
      params.sqJson,
      params.topicCategory,
    );
    const selectionParams = {
      unitTitle: params.unitTitle,
      summary: params.summary,
      context: params.context,
      learningTargets: learningTargetsFromSqJson(params.sqJson),
    };
    return applyMaterialComponentAvailability(
      ensureRequiredLabCategories(
        ensureRequiredMathCategory(stored, selectionParams, disabledTypes),
        selectionParams,
        disabledTypes,
      ),
      disabledTypes,
    );
  }
  return selectComponentCategories({
    unitTitle: params.unitTitle,
    summary: params.summary,
    context: params.context,
    learningTargets: learningTargetsFromSqJson(params.sqJson),
    topicCategory: params.topicCategory,
    contextSubject: params.contextSubject,
    extraDisabledComponentTypes: params.extraDisabledComponentTypes,
    signal: params.signal,
  });
}
