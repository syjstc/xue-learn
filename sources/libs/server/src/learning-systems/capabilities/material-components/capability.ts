import { type TopicCategory } from "../../../../../common/src/index.js";
import { componentCategoryCatalogPrompt } from "../../../llm/component-dsl-registry.js";
import { defineLearningSystemCapability } from "../../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../../types.js";
import { MATERIAL_COMPONENT_VIEW_KEYS } from "./keys.js";
import { GUIDED_IMAGE_SEGMENT_INSTRUCTION, GUIDED_IMAGE_NARRATION_INSTRUCTION } from "./guided-image/policy.js";
import {
  formatCourseSvgIntent,
  type CourseSvgIntent,
} from "../../../llm/course-svg-intent.js";

type ComponentSelectionPromptInput = {
  unitTitle: string;
  summary: string;
  context: string;
  learningTargets?: string;
  topicCategory: TopicCategory;
  disabledComponentTypes?: string[];
};
type InlineCheckPlanInput = {
  questionType: "mcq" | "mcq_multi" | "true_false";
  targetLabel: string;
  targetExplanation?: string;
  learningObjective?: string;
  assessmentCriterion: string;
  evidenceDimension: "memory" | "understanding";
  judgmentAngleHint?: string;
};
type InlineCheckPromptInput = {
  mode: "single" | "array";
  plans: readonly InlineCheckPlanInput[];
  unitTitle: string;
  language: string;
  context: string;
  avoidQuestions?: readonly string[];
};
type ComponentCompilePromptInput = {
  intentType: string;
  intentDescription: string;
  unitTitle: string;
  language: string;
  context: string;
  toolName: string;
  transport: "tool" | "structured";
};
type SvgPromptInput = {
  unitTitle: string;
  language: string;
  context: string;
  intent: CourseSvgIntent;
  revision?: {
    originalSvg: string;
    feedback: string;
  };
};

const MATERIAL_COMPONENT_SHARED_POLICY = `Material-component policy:
- Use structured teaching displays only when they materially improve the explanation; prose remains authoritative for transitions and interpretation.
- Prefer base/svg_slot for course-content visuals and use math_visualization only for genuine coordinate interaction. Course content does not emit chart components. Use a domain lab for runnable experiments.
- The server owns component ids, executable data, availability, compilation, and assessment items. Never invent those values.
- Component intent must stay inside the current unit and learning-target boundaries.`;

const COMPONENT_SELECTION_STABLE_INSTRUCTION = `Select interactive component families for lesson generation.
Return one compact structured selection object with only mainCategory, enabledCategories, and a concise rationale. mainCategory must be exactly one of base, math_visualization, mechanics_lab, circuit_lab, or chemistry_lab. enabledCategories must be a JSON array of those same ids. List only families that genuinely fit the unit; base is added automatically. Teaching diagrams, including process flows and concept maps, are an always-on base component via svg_slot (compiled raw SVG markup) and are not a selectable family. enabledCategories is an allowlist for later course-content authoring, not a requirement to instantiate anything.
Set mainCategory to the primary teaching-mode hint. It is valid to enable zero interactive families beyond base. Do not plan components, placements, ids, descriptions, or executable data in this call; the course-content author owns lesson-local component intents.
When a specialized family is the matching visual renderer, enable it: math_visualization only for genuine coordinate interaction, mechanics_lab for physics labs, circuit_lab for DC circuits, and chemistry_lab for certified chemistry experiments. Use svg_slot for process flows, concept maps, static quantitative comparisons, and other teaching schematics; it compiles to raw SVG markup and is static by default, with lightweight native SVG animation or interaction only when it materially improves the explanation. Do not emit chart components or chart data.
Enable mechanics_lab for physics (物理) experiments the learner should run — kinematics/dynamics, collisions, inclined plane, pendulum, spring oscillator — not only when the word mechanics appears. Enable circuit_lab only for DC electrical circuits the learner should wire or measure, including complex circuits, Ohm's law, series/parallel networks, and meters. Never substitute a domain lab with a later SVG.
Set rationale to a concise explanation of at most 240 characters. Do not write prose outside the structured response. The server owns component availability and later compilation.`;

export const MATERIAL_COMPONENT_COMPILE_STABLE_INSTRUCTION =
  "Compile exactly one server-selected interactive teaching component. Follow the bound component schema and supplied intent; output no unrelated prose or executable code.";

export const SVG_STABLE_INSTRUCTION = `Draw exactly one teaching diagram as raw SVG markup for the supplied lesson-local intent. This includes process flows and concept maps when requested. This is not image generation, a chart, a mathematical plot, or a lab. If the intent actually needs a specialized component, still draw only the bounded schematic requested here.
The lesson prose is authored by a separate request. Do not repeat or expand the lesson explanation; generate only the diagram markup and concise metadata required by the structured wrapper.
Return one structured object with exactly this shape:
{"type":"svg","title":"short title","caption":"what the learner should notice","alt":"short accessible description","svg":"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 600 400\\">...</svg>"}

The svg field is a complete <svg> document, not a JSON scene graph. Do not emit initialElements, steps, element ids, or kind/x/y objects. Use ordinary SVG tags (g, circle, ellipse, line, polyline, polygon, rect, path, text, tspan) with attributes such as stroke-width on the markup.

Picture rules:
- Treat the supplied visual brief as the picture contract from the material authoring step. Follow its composition as the layout: same reading order, relative placement, grouping, and arrow or flow directions. Include its required elements and relationships, use its labels when present, and honor its avoid list. Do not rearrange the scene or add a new concept merely because it would make the picture more elaborate.
- Start with a static picture. Add lightweight native SVG animation or interaction only when motion, a state change, or learner manipulation directly makes the course concept clearer; never add it as decoration.
- simple_structure, spatial_relationship, and state_comparison: one focused picture; when needed, use animation or interaction to reveal the relationship.
- step_derivation: draw the completed derivation by default. Use a short, learner-controlled SVG progression only when it materially improves comprehension; multi-step experiments still belong in the unit lab HTML playground.

Drawing rules:
- Draw only the bounded schematic. Refuse to approximate people, anatomy, body parts, hands, faces, animals, organic natural forms, realistic objects, or scenes as geometric silhouettes.
- Use a numeric viewBox (e.g. "0 0 600 400" or "0 0 800 450") with at least ~5% safe padding. Never draw past the viewBox edges.
- Compose for the whole viewBox before drawing details. Use a simple visual system: one dominant teaching region plus, only when needed, a quiet title, legend, or annotation region. Distribute content across both axes; never squeeze the meaningful geometry into a narrow strip while most of the canvas is empty. The occupied content bounds should normally use at least 60% of the viewBox width and 60% of its height.
- Keep the canvas conceptually transparent. Use currentColor for ordinary text, outlines, arrows, and neutral marks.
- Establish hierarchy with restrained typography: one short heading at most, concise labels, and quieter secondary annotations. All visible text must use font-size >= 14. Text must never overlap, cover, or be crossed by other text, shapes, borders, connectors, arrows, or the canvas edge; reserve enough clear space around every label. Do not place sentence-length labels directly on lines or curves; use a compact legend, leader line, or dedicated annotation area instead.
- Vectors and arrows must originate from and terminate at their intended targets. Geometric shapes must be proportioned to the concept.
- Keep the diagram focused and legible on a phone: normally no more than 12 principal objects and 12 short visible labels.
- Use a course-friendly 4:3, 3:2, or 16:9 composition. Let teaching content occupy roughly 65–85% of the canvas.
- Use consistent strokes and no more than five semantic colors. Prefer flat fills, softly tinted grouping surfaces where useful, and strong contrast between data/meaning marks and supporting grid or scaffolding. Avoid a bare debug-plot appearance.
- Keep labels short and outside crowded shapes.
- For a quantitative schematic with axes, curves, number lines, or measured states: reserve a broad rectangular plot region, show only useful ticks/grid lines, include units when supplied, and keep series names in a legend or clear endpoint callouts outside the data paths. Highlight the teaching result with one restrained annotation (for example a guide line and short callout), not oversized text laid across the plot. Choose axis ranges and plot proportions that reveal the relationship rather than compressing it. This remains a teaching schematic, not a generic chart component.
- This is a schematic teaching picture, not a scientific scale claim. Make simplifications clear in the caption or labels when relevant.
- Draw only what the context supports. Do not invent measured values, quantities, or factual labels.
- The svg field is preserved as authored. You may use native SVG elements, inline styles, CSS transitions/keyframes, SMIL animation, and self-contained interaction when they help the learner. Keep dynamic behavior short, purposeful, and usable on touch as well as pointer devices. Do not rely on external assets or network resources; return one self-contained SVG.`;

const SVG_VISUAL_AUDIT_STABLE_INSTRUCTION = `你只负责审查一张服务器渲染完成的教学图片。不要分析制作格式、代码或实现方式，也不要创作替代图片。先根据教学要求判断图片表达的知识是否正确：确认核心结论，逐项核对对象、数量、形状、位置、层级、包含、连接、方向、顺序、状态以及与主题有关的专业关系。必须以实际画面为证据；标签、公式、标题或图例正确，不能抵消几何、位置、连线或方向错误。核心关系错误、相反、缺失或含糊的优先级最高。内容正确后，再重点检查手机尺寸下的文字可读性：任何文字都不得与其他文字、图形、容器边框、连接线、箭头或画布边缘重叠、相交、贴压或互相遮挡；文字跨出所属容器、线条穿过文字、长句压住边框，以及标签虽可辨认但侵占其他对象空间，都必须判定需要修正。随后检查裁切、字号、对比度、标签位置、视觉层级、辨识度、比例、对齐、交点、锚点、曲线质量、拥挤、无意义交叉和留白。若主要图形被挤成狭长区域、画布大面积无意义空置、坐标图过窄导致趋势难辨，或长标签直接压在曲线/数据区域上，必须判定 needs_repair；应要求扩大并平衡主要绘图区，将系列名称移至图例或清晰的端点标注，并只保留有助阅读的刻度和网格。最后以较低优先级检查美观度和视觉完成度，包括构图平衡、间距节奏、样式一致性、配色协调以及是否存在明显粗糙或突兀之处；美观问题仍需检查和修正，但不得凌驾于知识正确性、结构和可读性之上。不要因为要求中的对象都已出现或文字仍勉强可辨认就判定通过，也不要仅因个人风格偏好要求修正。只有不存在内容、文字遮挡、其他可用性或明显美观缺陷时才使用 good，否则使用 needs_repair。反馈必须具体指出问题位置、当前画面实际呈现、错误原因、可执行改法和可观察的验收条件；按内容或结构、文字遮挡与视觉可用性、美观度的优先级描述，禁止只写“优化布局”或“更美观”。`;

export const HTML_PLAYGROUND_STABLE_INSTRUCTION = `Build exactly one self-contained interactive HTML teaching playground for a unit lab item. This is not in-lesson SVG, a chart library, or a typed physics/circuit sandbox.
Return one structured object with exactly this shape:
{"type":"interactive_html","title":"short title","summary":"what the learner should notice","html":"<div class=\\"xl-lab\\">...</div>","visualKind":"simple_structure"}

The html field is body content for a host document that already injects XueLearn design tokens and window.XueLearnLab:
- Use host classes: xl-lab, xl-panel, xl-card, xl-title, xl-caption, xl-btn, xl-btn-ghost, xl-row, xl-fade, xl-slide. Do not restyle html/body or invent a second design system.
- Call XueLearnLab.play() / replay() / onFrame(cb) for shared play/replay instead of a custom timeline chrome.
- Inline CSS and JavaScript only. No network, no CDN, no <script src>, no <iframe>, no <object>, no <embed>, no <base>, no remote images (data: URLs are allowed).
- Use buttons, sliders, drag handles, or stepped controls so the learner can change the pictured relationship.
- simple_structure / spatial_relationship / state_comparison: one interactive picture with controls that reveal the relationship. step_derivation: 2-5 learner-stepped states inside this lab page.
- Draw only the bounded schematic. Refuse people, anatomy, animals, organic forms, and realistic scenes.
- Keep labels short, font-size readable on a phone, and the canvas roughly 4:3 or 16:9.
- The host is a light teaching surface. Never fill the whole viewport with black.
- Put every visible string in the requested language.
- Do not invent measured values the context does not support.`;

function buildSvgPrompt(params: SvgPromptInput): string {
  const revision = params.revision
    ? `\n修正请求：\n以下原结果已经渲染并完成图片审查。请直接基于原结果修正反馈指出的问题，保留所有正确内容、结构和样式，不要无故重新设计整张图片；只有局部修改无法解决核心错误时，才重构必要的相关区域。\n审查反馈：\n${params.revision.feedback.slice(0, 4_000)}\n原始内容：\n${params.revision.originalSvg.slice(0, 30_000)}`
    : "";
  return `Write title, caption, alt, and every visible SVG label in ${params.language}.
The declared visual kind is ${params.intent.visualKind}.
Lesson: ${params.unitTitle}
${formatCourseSvgIntent(params.intent)}
Lesson context excerpt:
${params.context.slice(0, 6_000)}${revision}`;
}

function componentTypeRules(type: string): string {
  if (type === "chart") {
    return `
For chart:
- Emit each data row as {entries:[...]}. Each entry must contain key, valueType, stringValue, and numberValue. For a string value set valueType to "string", put the value in stringValue, and set numberValue to 0. For a numeric value set valueType to "number", put the value in numberValue, and set stringValue to "".
- Every series item must include color and unit; use "" when either is not needed. Include categoryKey, xKey, yKey, xLabel, yLabel, and root unit; use "" for keys or labels that do not apply.
- Use a chart only for real numeric values supplied by the lesson context or values that are explicitly computed from them. Never invent measurements, survey results, probabilities, or historical series merely to make the lesson visual.
- This component renders exactly one chart encoding. Follow the encoding requested by the intent; do not claim in the title or summary that a second chart type is shown. A representation comparison is planned upstream as multiple chart components.
- Choose the chart by the relationship being taught: line/area for change over an ordered continuum, bar for category comparison, pie/donut only for parts of one whole that sum coherently, and scatter for paired numeric observations or a relationship between two variables.
- Keep the data focused: normally 3-8 categories or points and 1-3 series. Prefer the smallest dataset that makes the teaching point visible.
- Use learner-readable axis/series labels and units. The summary must interpret the specific pattern, comparison, composition, or correlation the learner should notice rather than merely naming the chart.
- Do not use a chart for a procedure, hierarchy, causal chain, architecture, or concept map; those belong in svg_slot.`;
  }
  if (type === "math_scene") {
    return `
For math_scene:
- Emit the provider wire shape with separate points, vectors, segments, functions, parametricCurves, polarFunctions, and surfaces arrays. Include every array, using [] when that object kind is unused. Do not emit an objects array.
- Coordinates in those typed arrays are numeric x/y/z fields only. Never put expressions such as -b/(2*a) in a coordinate. Parameter ids may appear inside function, parametric-curve, polar-function, and surface expression strings, or as a scaled vector's relationFactorParameter.
- Always include zRange. For a 2d scene use a harmless numeric range such as [-1, 1]; the server removes it after transport validation.
- Author a renderer-neutral mathematical scene, never SVG, JavaScript, Mermaid, Plotly, or layout coordinates.
- Use dimension 2d for points, vectors, segments, y=f(x), parametric curves, and polar functions. Use dimension 3d for spatial points/vectors/segments, parametric curves, and z=f(x,y) surfaces.
- coordinateSystem is cartesian except for a polar_function, which requires a 2d polar scene.
- Every object needs a unique short id. Coordinates have exactly 2 values in 2d and 3 values in 3d.
- Supported expression operators are + - * / ^ and supported functions are abs, sin, cos, tan, asin, acos, atan, sqrt, exp, ln, log, log10, min, max, floor, ceil, round, and sign. Constants pi and e are supported. Never emit code or assignments.
- Keep ranges tight around the teaching content, but every explicit point, vector endpoint, and segment endpoint must fall inside the corresponding ranges with visible margin. Use at most 8 objects normally. A 3d scene must include zRange.
- When vectors overlap or are collinear, give every vector a distinct color and label. Include enough surrounding range that every arrowhead and label remains visible.
- Use function for y=f(x), parametric for coordinate expressions over t, polar_function for r=f(theta), and surface for z=f(x,y).
- Static scenes are the default: derive fixed coordinates and expressions from the supplied course content and emit parameters: []. Never invent sliders merely because a quantity could vary, and never parameterize literal point or segment coordinates.
- Every point, vector, and segment in the provider wire shape must include draggable. Set it false unless the Intent explicitly asks the learner to move that object's handle; draggable handles are available only in 2d. A draggable point moves its position, a draggable vector moves its end, and a draggable segment moves its to endpoint.
- Every vector must include relationOperation, relationOperandA, relationOperandB, relationFactor, and relationFactorParameter. Use relationOperation "none", empty operand strings, relationFactor 1, and an empty relationFactorParameter for an independent vector.
- To keep vector arithmetic live, use relationOperation "sum" or "difference" with the two source vector ids in relationOperandA/relationOperandB, or "scale" with the source id in relationOperandA and its numeric scalar in relationFactor. For a learner-controlled scalar, also declare that scene parameter and put its id in relationFactorParameter; otherwise use an empty string. Derived vectors must set draggable false. Relations use vector displacement (end minus start), work in both 2d and 3d, and may be composed to visualize linear combinations. Do not create relation cycles.
- Prefer this interaction vocabulary only when the Intent explicitly asks for manipulation. It supports several valid scene designs: free point/geometry exploration; movable independent vectors; live vector sum/difference/scalar-multiple comparison; coefficient sliders for y=f(x); rotatable 3d scenes; and static plots when interaction would not aid the objective.
- Only when the Intent explicitly asks the learner to change a meaningful coefficient or scalar may you add 1-3 parameters with id, name, min, max, step, and default. Reference coefficient ids in expression strings and vector scalar ids in relationFactorParameter. This includes 3d surface/curve shape parameters and coefficients in 2d or 3d vector combinations. Do not infer this interaction from the broader lesson context. Do not fake parameter changes with several overlapping objects.
- Parameters are supported for function, parametricCurves, polarFunctions, surfaces, and scaled-vector relations in either supported dimension. If none is present, parameters must be [].
- The summary must state the specific visual relationship the learner should notice.`;
  }
  if (type === "mechanics_sandbox") {
    return `
For mechanics_sandbox:
- Choose sandboxType from collision_1d, inclined_plane, pendulum, or spring_oscillator.
- Define objects with positive mass (in kg), initialPosition, and initialVelocity.
- For collision_1d, provide two objects (e.g. carts or spheres) and parameters for initial velocities and restitution.
- Set showVectors to true and showEnergyChart to true to illustrate momentum and energy conservation.`;
  }
  if (type === "circuit_sandbox") {
    return `
For circuit_sandbox:
- Author a nested series/parallel tree in \`circuit\`. Do not assign node ids, wires, or x/y coordinates.
- Parts: {id, kind} where kind is battery | resistor | rheostat | switch | bulb | ammeter | voltmeter.
- Use v for battery volts, ohm/min/max for resistors, closed for switches, ratedV/ratedW for bulbs.
- Top-level series is the loop in order. Nest parallel for branches; nest series inside a branch for mixed circuits.
- Ammeter goes in series; voltmeter goes in parallel with the part it measures.
- Example: {"circuit":{"series":[{"id":"bat","kind":"battery","v":6},{"id":"sw","kind":"switch","closed":true},{"parallel":[{"id":"l1","kind":"bulb"},{"id":"r1","kind":"resistor","ohm":20}]}]}}`;
  }
  if (type === "chemistry_lab") {
    return `
For chemistry_lab:
- Use only one certified experimentId: acid_base_indicator, acid_base_titration, precipitation_reaction, or mass_conservation.
- Keep experimentVersion at 1 and parameters numeric; the server supplies all reaction rules, substances, apparatus, observations, and operation guards.
- Never emit arbitrary reaction equations, free-form substances, executable code, scene graphs, or unsafe procedures.
- This is compiled after the lesson as a 会学实验室 activity with immediate observations only; it does not write scores or mastery evidence.`;
  }
  return "";
}

function buildComponentCompilePrompt(
  params: ComponentCompilePromptInput,
): string {
  const callRule =
    params.transport === "tool"
      ? `Call ${params.toolName} exactly once. Do not return prose.
Prefer top-level tool arguments (not nested under "component").`
      : 'Return exactly one structured component object. Do not return prose.\nPrefer top-level structured fields (not nested under "component").';
  return `Build exactly one interactive course component.
${callRule} Example shape: {"type":"${params.intentType}",...}.
A nested {"component":{"type":"${params.intentType}",...}} wrapper is also accepted.
Always set type to "${params.intentType}" (do not omit type even though the tool name already implies it).
The component must use language "${params.language}" and teach only unit "${params.unitTitle}".
All learner-visible fields must use natural teaching language. Never expose
internal learning-target refs such as lt_1 or criterion refs such as lt_1:c1.
Use stable short ids. Ensure referenced ids exist and all required arrays are non-empty.${componentTypeRules(params.intentType)}

Intent: ${params.intentDescription}
Relevant context: ${params.context.slice(0, 1600)}`;
}

function buildInlineCheckPrompt(params: InlineCheckPromptInput): string {
  if (params.mode === "array") {
    return `Create exactly ${params.plans.length} short test questions in one response.
Return one root JSON array in the fixed order below. Each item must contain questionType, question, explanation, and the answer fields required by that questionType:
- mcq: options (2-6 distinct choices) and correctIndex. Exactly one correct answer. Never say “select all that apply”.
- mcq_multi: options (3-6 distinct choices) and correctIndices (at least two). The stem may say select-all-that-apply.
- true_false: correctAnswer

Do not add learning-target ids or evidence metadata. Do not repeat or closely paraphrase another item in the array.
Unit: ${params.unitTitle}
Use ${params.language}.
Every question must use only content explicitly taught in the lesson context.

Fixed question slots:
${params.plans
  .map(
    (plan, index) => `${index + 1}. questionType=${plan.questionType}
   Published learning target: ${plan.targetLabel}
   Target explanation: ${plan.targetExplanation ?? ""}
   Learning objective: ${plan.learningObjective ?? ""}
   Assessment criterion: ${plan.assessmentCriterion}
   Evidence dimension: ${plan.evidenceDimension}
   Judgment angle: ${plan.judgmentAngleHint ?? ""}`,
  )
  .join("\n")}

Lesson context:
${params.context}`;
  }
  const plan = params.plans[0];
  if (!plan) return "";
  const angle = plan.judgmentAngleHint
    ? `Judgment angle: ${plan.judgmentAngleHint}`
    : "";
  const avoid = params.avoidQuestions?.length
    ? `Do not repeat or closely paraphrase these existing questions: ${JSON.stringify(params.avoidQuestions)}`
    : "";
  const shared = `Unit "${params.unitTitle}".
Use ${params.language}.
The question must directly test the supplied assessment criterion using only content taught in the lesson context.
Do not claim application or transfer from a recall/understanding item.
${angle}
${avoid}

Published learning target: ${plan.targetLabel}
Target explanation: ${plan.targetExplanation ?? ""}
Learning objective: ${plan.learningObjective ?? ""}
Assessment criterion: ${plan.assessmentCriterion}
Evidence dimension: ${plan.evidenceDimension}

Lesson context:
${params.context}`;
  if (plan.questionType === "mcq_multi") {
    return `Create one short select-all-that-apply inline check.
Return exactly one structured object containing only question, options, correctIndices, and explanation.
Provide 3-6 distinct plausible options with at least two correct answers.
${shared}`;
  }
  if (plan.questionType === "true_false") {
    return `Create one short true/false inline check.
Return exactly one structured object containing only question, correctAnswer, and explanation.
The question must be a single declarative statement the learner judges as true or false.
${shared}`;
  }
  return `Create one short, unambiguous inline multiple-choice check.
Return exactly one structured object containing only question, options, correctIndex, and explanation.
Use 2-6 distinct, plausible options with exactly one correct answer.
Do not ask the learner to “select all that apply”; that wording is only for mcq_multi.
${shared}`;
}

function buildComponentSelectionPrompt(
  params: ComponentSelectionPromptInput,
): string {
  const disabledComponentTypes = [
    ...new Set(params.disabledComponentTypes ?? []),
  ].sort((left, right) => left.localeCompare(right));
  const mathematicsVisualizationRule =
    params.topicCategory === "mathematics"
      ? `\nThis is a mathematics unit: match the display to the object. Enable math_visualization when functions, geometry, vectors, transformations, or relationships between representations need coordinate interaction; use svg_slot when the object is a schematic picture; use a text board or ordinary stage subviews when that is the object. Do not treat any type as a quota.`
      : "";
  const labRule = `\nIf this unit is a DC circuit (including 复杂电路, Ohm's law, series/parallel, Kirchhoff, meters, or bulbs), enable circuit_lab. If it is a physics experiment (物理, kinematics/dynamics, collision/momentum, inclined plane, pendulum, or spring oscillator), enable mechanics_lab.`;
  const disabledRule = disabledComponentTypes.length
    ? `\nAdministrator-disabled component types: ${disabledComponentTypes.join(", ")}. Do not enable a family solely for one of these unavailable types.`
    : "";
  return `${componentCategoryCatalogPrompt(params.topicCategory)}
${disabledRule}
${mathematicsVisualizationRule}
${labRule}

Unit: ${params.unitTitle}
Summary: ${params.summary}
Published learning targets:
${params.learningTargets?.trim() || "(not supplied)"}
Context excerpt: ${params.context.slice(0, 1800)}`;
}

const MATERIAL_COMPONENT_OPERATION_INSTRUCTIONS = Object.freeze({
  [MATERIAL_COMPONENT_VIEW_KEYS.guidedImageSegmentInstructionContext]: GUIDED_IMAGE_SEGMENT_INSTRUCTION,
  [MATERIAL_COMPONENT_VIEW_KEYS.guidedImageNarrateInstructionContext]: GUIDED_IMAGE_NARRATION_INSTRUCTION,
  [MATERIAL_COMPONENT_VIEW_KEYS.policyContext]:
    MATERIAL_COMPONENT_SHARED_POLICY,
  [MATERIAL_COMPONENT_VIEW_KEYS.selectionInstructionContext]:
    COMPONENT_SELECTION_STABLE_INSTRUCTION,
  [MATERIAL_COMPONENT_VIEW_KEYS.inlineCheckInstructionContext]:
    "Author only the requested server-planned selected-response check content. Preserve fixed question types and order; never author evidence bindings or learning-target identifiers.",
  [MATERIAL_COMPONENT_VIEW_KEYS.compileInstructionContext]:
    MATERIAL_COMPONENT_COMPILE_STABLE_INSTRUCTION,
  [MATERIAL_COMPONENT_VIEW_KEYS.svgInstructionContext]: SVG_STABLE_INSTRUCTION,
  [MATERIAL_COMPONENT_VIEW_KEYS.svgVisualAuditInstructionContext]:
    SVG_VISUAL_AUDIT_STABLE_INSTRUCTION,
  [MATERIAL_COMPONENT_VIEW_KEYS.htmlInstructionContext]:
    HTML_PLAYGROUND_STABLE_INSTRUCTION,
});

export function buildMaterialComponentInvocationPrompt(
  key: string,
  invocation: unknown,
): string | null {
  if (key === MATERIAL_COMPONENT_VIEW_KEYS.selectionInstructionContext) {
    const input = invocation as ComponentSelectionPromptInput | undefined;
    return input?.unitTitle ? buildComponentSelectionPrompt(input) : null;
  }
  if (key === MATERIAL_COMPONENT_VIEW_KEYS.inlineCheckInstructionContext) {
    const input = invocation as InlineCheckPromptInput | undefined;
    return input?.unitTitle && input.plans.length > 0
      ? buildInlineCheckPrompt(input)
      : null;
  }
  if (key === MATERIAL_COMPONENT_VIEW_KEYS.compileInstructionContext) {
    const input = invocation as ComponentCompilePromptInput | undefined;
    return input?.intentType && input.unitTitle
      ? buildComponentCompilePrompt(input)
      : null;
  }
  if (key === MATERIAL_COMPONENT_VIEW_KEYS.svgInstructionContext) {
    const input = invocation as SvgPromptInput | undefined;
    return input?.unitTitle && input.intent?.learningGoal
      ? buildSvgPrompt(input)
      : null;
  }
  if (key === MATERIAL_COMPONENT_VIEW_KEYS.htmlInstructionContext) {
    const input = invocation as SvgPromptInput | undefined;
    return input?.unitTitle && input.intent?.learningGoal
      ? buildSvgPrompt(input)
      : null;
  }
  return null;
}

export function createMaterialComponentsCapability() {
  const capabilityId = "material-components";
  const version = "1.2.0";
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: Object.fromEntries(
      Object.entries(MATERIAL_COMPONENT_OPERATION_INSTRUCTIONS).map(
        ([key, instruction]) => [
          key,
          async ({ subject }: SystemViewRequest): Promise<ContextEnvelope> => ({
            ownerCapabilityId: capabilityId,
            ownerCapabilityVersion: version,
            schemaVersion: 1,
            authority: "server_policy",
            scope: { ...subject },
            freshness: { asOf: new Date(0).toISOString(), stale: false },
            data: { promptBlock: instruction },
          }),
        ],
      ),
    ),
  });
}
