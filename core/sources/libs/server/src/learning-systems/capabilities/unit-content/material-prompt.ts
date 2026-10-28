import { COURSE_MUSIC_DISPLAY_CONTRACT, COURSE_MUSIC_INSTRUCTION } from "./music-instruction.js";
export { COURSE_MUSIC_INSTRUCTION } from "./music-instruction.js";
import { supportsDisplay, getActivePresentationCapabilities, presentationCapabilityInstruction } from "../../../llm/display-capabilities.js";
import type { PresentationCapabilities } from "../../../../../domain/src/presentation-capabilities.js";
import { GOAL_DIRECTED_TEACHING_POLICY } from "../../../goal-creation/teaching-policy.js";
// Private material-authoring prompt source owned by unit-content capability.
import { courseMaterialSubviewRequirements } from "../../../domain/unit-session-duration.js";
import { UNIT_SHARED_CONTEXT_REUSE_LINE } from "../../../graph/unit-session-prompts.js";
import type { PlanContext } from "../../../llm/context/plan-context.js";
import type { TopicCategory } from "../../../../../common/src/index.js";
import { isRuiyanShadowTeachingPersona, MATERIAL_TEACHING_AUTHORING_RULES } from "../../../../../domain/src/index.js";
import {
  getPromptLanguageLabel,
  type ContentLanguageCode,
} from "../../../llm/content-language.js";
import { compactSqJsonArg } from "../../../llm/compact-json.js";
import {
  componentSelectionFromSqJson,
  matchingRendererAuthoringGuide,
  materialGenerationPolicyFromSelection,
  LAB_ACTIVITY_COMPONENT_TYPES,
  VISUAL_RENDERER_PRIORITY_RULE,
  type ComponentCategorySelection,
} from "../../../llm/component-dsl-registry.js";
import { COURSE_MATERIAL_CHAT_VOICE_RULES } from "../../../graph/course-material-prose.js";
import { COURSE_SVG_SLOT_INTENT_CONTRACT } from "../../../llm/course-svg-intent.js";
import { COURSE_LEARNER_FACING_CONTENT_INSTRUCTION } from "../../../llm/learner-facing-text.js";

const COURSE_MATERIAL_GENERATION_BLOCK_LIMIT = 120;

export function isDesktopDevRuiyanShadowIllustrationMode(
  plan?: {
    styleBlock?: string | (() => string);
    teachingPersonaRef?: string;
    teachingPersonaArchetype?: string;
  } | null,
): boolean {
  if (process.env.XUELEARN_DESKTOP_DEV !== "1") return false;
  if (!plan) return false;
  if (
    "teachingPersonaArchetype" in plan &&
    isRuiyanShadowTeachingPersona(plan.teachingPersonaArchetype)
  ) {
    return true;
  }
  if (
    "teachingPersonaRef" in plan &&
    isRuiyanShadowTeachingPersona(plan.teachingPersonaRef)
  ) {
    return true;
  }
  const style =
    typeof plan.styleBlock === "function" ? plan.styleBlock() : plan.styleBlock;
  if (typeof style === "string" && isRuiyanShadowTeachingPersona(style)) {
    return true;
  }
  return false;
}

export function isDesktopDevRuiyanShadowGuidedImageMode(
  plan?: { teachingPersonaRef?: string } | null,
): boolean {
  return process.env.XUELEARN_DESKTOP_DEV === "1" && supportsDisplay("guided_image_intent")
    && plan?.teachingPersonaRef === "builtin:ruiyan_shadow_female";
}

/** Select the evidence the learner needs to see before choosing a renderer. */
export const COURSE_DISPLAY_SELECTION_INSTRUCTION = `Choose each display by what the learner needs to observe, not by a preferred component. A picture can carry the core explanation. Exception for native music evidence on Web/Electron: staff/ledger lines, notes, rhythms, keyboard positions and score-to-key relations use music teaching views even without playback; do not draw these as generated pictures. Photographs of instruments or hands remain pictorial evidence. When appearance, spatial arrangement, visible evidence, a concrete scene or changes within it explain the idea, use illustration when enabled, or guided_image_intent in the active image-first workflow. This includes physical processes and layered objects: the words process, cycle or layer do not automatically select a native visual. Use built-in visual only when abstract order, grouping or supplied quantities fully express the teaching relationship; do not replace meaningful pictorial evidence with labeled boxes or prose cards. For example, teach a character's position, a wall and an occluded line of sight with a spatial picture; a pure input-to-output label mapping can use a process diagram. Plan what the learner should notice in the picture, then use cues to move from the whole to relevant parts and their relationships while retaining enough context. Narration must explain visible evidence, not invent objects or details absent from the image. Text and diagrams can complement pictures across topics. Do not impose an image quota or add decorative images; respect current image availability and surface restrictions.`;

export const RUIYAN_SHADOW_GUIDED_IMAGE_INSTRUCTION = `Image-first teaching pilot for this teacher:
Use built-in visual only when abstract order, grouping or supplied quantities fully explain the topic without losing meaningful pictorial evidence, with ordinary cues targeting item ids. Use a picture when concrete appearance, spatial relationships or visible changes carry the explanation, including physical processes and layered objects.
When a topic needs a picture, commit display={type:"guided_image_intent",id,intent} and cues: []. This overrides older illustration/SVG instructions and any instruction to narrate the proposed picture immediately. Never emit image URLs, masks, region coordinates, or picture narration yourself.
intent contains id, title, language, learningGoal, assumedKnowledge, composition, parts and relationships. Each part has a stable lowercase id, label, visualDescription, teachingPoints (real content to explain), and required. Relationships reference part ids with from, to, meaning. Describe one coherent complete picture, with distinguishable objects and enough separation for irregular silhouette selection; parts can have disconnected pieces. Describe the learning content and exact labels; do not compose a collage of prose cards. Cap a picture at eight useful parts; split genuinely distinct ideas across topics.
The child workflow generates the image, examines actual pixels, segments/refines regions, and ONLY THEN writes narration from your intent plus the observed image using this teacher's voice. Native teaching, music, visual, code, callout, accordion or conversation topics remain available with their ordinary spoken cues when those displays fit the teaching object. For staff/ledger lines, clefs, notes, intervals, rhythms, keyboard positions and score-to-key relationships, use native music teaching views even when silent. Ordinary cues can explicitly schedule music after speech. Never turn these diagrams or a playable score into guided_image_intent. Pictures must be one top-level guided_image_intent, not nested in a stage. Teach substantive material, not implementation details about images or this workflow.`;

export const DESKTOP_DEV_RUIYAN_SHADOW_DISABLED_IN_LESSON_TYPES = [
  "math_scene",
] as const;

export function extraDisabledMaterialTypesForRuiyanShadowDev(
  plan?: Parameters<typeof isDesktopDevRuiyanShadowIllustrationMode>[0],
): string[] {
  return isDesktopDevRuiyanShadowIllustrationMode(plan)
    ? [...DESKTOP_DEV_RUIYAN_SHADOW_DISABLED_IN_LESSON_TYPES]
    : [];
}

const RUIYAN_SHADOW_DEV_VISUAL_OVERRIDE =
  "Ignore any teaching-skill or Survey guidance that names math_scene, svg_slot, or chart. Those in-lesson displays are replaced by illustration blocks (static pictures; a later animated display will replace them). Do NOT emit math_scene, svg_slot, SVG markup, or executable scene JSON.";

/** Reuses figure ids and spoken cues; no separate animation generation. */
export const COURSE_PRESENTATION_INSTRUCTION = `Web/Electron stage may add presentation: steps for an ordered procedure, compare for parallel alternatives, focus for a main object with supporting explanation. Reuse 2–4 ordinary figures and their cue targetIds. For callouts, keep 2–5 independently readable short Markdown units: blank-line-separated paragraphs or individual single-line list items. To teach inside a card, target its virtual id <callout-id>:detail-1, :detail-2, etc. in source order; each cue reveals that unit and highlights it while retaining previously taught units. Use the card id to show its complete body. Complex Markdown (tables, nested lists, code fences or display math) stays whole and has no detail ids. Prefer detail cues when explaining a definition then its concrete example, or building conditions one by one; keep essential context in the first unit and never hide a needed premise. Do not repeat definitions inside an example merely to fill another card. Steps follow figure order; a cue targeting the display shows the whole board. In presentation stages, code figures use code once, omit parts, and cue the figure id or regions[].id whose match is exact source. Compose one dominant teaching object with only necessary short support; do not fill the canvas with repeated prose cards. Board copy is a short label, formula, mapping or condition, not a second transcript. Wrap on-screen math in $...$. Each cue must add a fact, cause, condition, worked example or necessary learner action. Explain each distinction once; remove repeated metaphors, sarcastic asides, generic announcements and rhetorical padding. State the fact directly instead of appending judgments about the learner, jokes or imaginary objections. When rewriting wordy source prose, extract the distinct teaching facts first and rebuild concise cues from them; do not paraphrase every original sentence. Preserve premises, definitions, examples and misconceptions; do not mechanically truncate facts or add a recap that only repeats the preceding cue. Prefer one or two short sentences per cue; use as many cues as the actual teaching requires. Omit presentation when unnecessary. Never emit coordinates, keyframes, timing, colors, or duplicate speech; the renderer owns layout, transitions and existing design tokens.`;

/** Asset-free grammar; renderer owns all geometry and animation. */
export const COURSE_VISUAL_INSTRUCTION = `Web/Electron: use built-in visual when abstract order, cyclic relationships, structural hierarchy or supplied numerical comparisons fully express the teaching object without meaningful pictorial evidence: {type:"visual",id,kind:"process|cycle|layers|bars",title,items:[{id,label,detail?,value?}],unit?}. Use 2–5 items, title <=60 chars, labels <=24, details <=60. Process/cycle follow item order; cycle closes last to first; layers list the foundation first (bottom), outermost last (top). Only bars accept value (required, finite, non-negative) and unit; use supplied factual data, never invent quantities. All ids must be unique on the board; cues target item ids or the display id for overview. No image API, SVG source, coordinates or timing needed. Put explanations in cues; prefer one visual per topic; optionally use stage main+rail with one brief callout helper.`;

/** Shared semantic demonstrations; captions own operation timing on every surface. */
export const COURSE_TEACHING_INSTRUCTION = `Use a native teaching display when a supported mathematical, physical, algorithmic, scientific or other typed demonstration expresses the evidence. Sorting comparisons and swaps, recursive calls and returns, or a changing quantity need their own narrated operation cues. The same saved display and cues drive reading, classroom and video. Do not replace a supported demonstration with a static picture or a sequence of prose cards. Use ordinary visual for simpler label-only relationships.
${MATERIAL_TEACHING_AUTHORING_RULES}`;

/** Durable topic rewrites can reuse prompts from before a display was supported. */
export function withCurrentCourseDisplayInstructions(
  prompt: string,
  transcript: readonly { role: string; content: string }[],
  options: { capabilities?: PresentationCapabilities; imageFirst: boolean; pluginInstruction?: string },
): string {
  if (options.pluginInstruction) return `${prompt}\n\n${COURSE_LEARNER_FACING_CONTENT_INSTRUCTION}\n${options.imageFirst ? RUIYAN_SHADOW_GUIDED_IMAGE_INSTRUCTION : ""}\n\nCurrent display contract:\n${options.pluginInstruction}`;
  const instructions = [COURSE_LEARNER_FACING_CONTENT_INSTRUCTION,
    ...(supportsDisplay("music", options.capabilities) ? [COURSE_DISPLAY_SELECTION_INSTRUCTION, COURSE_MUSIC_INSTRUCTION] : []),
    ...(supportsDisplay("stage", options.capabilities) ? [COURSE_PRESENTATION_INSTRUCTION] : []),
    ...(supportsDisplay("visual", options.capabilities) ? [COURSE_VISUAL_INSTRUCTION] : []),
    ...(supportsDisplay("teaching", options.capabilities) ? [COURSE_TEACHING_INSTRUCTION] : []),
    ...(options.imageFirst && supportsDisplay("guided_image_intent", options.capabilities) ? [RUIYAN_SHADOW_GUIDED_IMAGE_INSTRUCTION] : []),
    presentationCapabilityInstruction(true, options.capabilities)];
  const missing = instructions.filter((instruction) => instruction && !prompt.includes(instruction)
    && !transcript.some((message) => ["system", "user"].includes(message.role) && message.content.includes(instruction)));
  return missing.length ? `${prompt}\n\nCurrent display contract (supersedes older display restrictions):\n${missing.join("\n")}` : prompt;
}

export const COURSE_MATERIAL_STABLE_INSTRUCTION = `Author one focused interactive unit-content artifact. Follow the supplied unit or section boundaries, learning targets, teaching policy, and structured material contract exactly.

${GOAL_DIRECTED_TEACHING_POLICY}

${COURSE_LEARNER_FACING_CONTENT_INSTRUCTION}

${COURSE_DISPLAY_SELECTION_INSTRUCTION}

Invariant authoring rules:
- Text displays remain JSON callout/stage blocks. For a genuine concept contrast, use 2–4 ordinary definition figures in a split-h stage with short titles. When the concepts share concrete dimensions, write each body as Markdown paragraphs in exactly the same dimension order, e.g. **Input**: current information, then **Output**: the result. Use bold labels followed by a colon and one dimension per paragraph; localize the labels to the content language. Do not invent common dimensions or discard qualifications to force a table. A final tip/warning figure may carry the shared boundary within the existing four-figure limit. No image, SVG, standalone compare block, or extra JSON field is needed for a text contrast.
- Choose callout variants by teaching purpose: definition states the core meaning; example contains a concrete situation and result; warning states a misconception or boundary; tip is a short supporting note. Use ordinary-weight sentences and bold only essential words, rather than making every sentence a bullet or repeating the title.
- Include exactly one lesson-specific introduction that starts from the section's new idea or task, followed by multiple small topics. Do not reopen with a generic unit overview, repeated motivation, or recap.
- Course content must never address the learner by personal name or emit the {{learnerName}} placeholder. Use natural second-person wording (such as “你” / “you”) only when useful.
- First call commit_section_topics with unique topic ids and titles (optional introduction). Then call commit_topic_material once per topic, in order. One topic has exactly one display; a second board is a new topic.
- Every learner-facing string in commit_section_topics and commit_topic_material (titles, labels, points, captions, conversation turns, cue speech) must use the goal content language from the language block. The prompts and tool schema are English; do not follow them into English teaching prose or mix languages inside one topic.
- Teach every published learning target in the Survey preview without inventing unrelated topics. Treat target importance, difficulty, cognitive level, objective, and assessment criteria as binding coverage instructions.
- For core points newly taught here, include a clear explanation, worked application, and common misconception or failure mode. For an already taught core point reused here, demonstrate its new application without repeating the definition, derivation and old worked example. Do not write quiz questions into the lesson body; section mini-tests are generated later.
- For new supporting points, include a concise explanation and application. Previously taught supporting points need only the reminder necessary for the current task. Keep enrichment optional.
- Before output, silently audit that every core objective and assessment criterion can be met from this lesson and the supplied actual earlier teaching. Each topic must add a distinct new insight or application; merge or remove topics that only restate earlier teaching. Repair missing foundations before first use.
- Internal learning-target refs are metadata only. Never include them in learner-visible text; use the target's natural-language label instead.
- Answer the Survey guiding questions where relevant.
- Do not emit inline-check references, check blocks, quiz placeholders, executable complex blocks, or SVG source.
- Treat every inline display as part of the core explanation, not decoration. Show the object first, then lecture with spoken cues: attention, meaning, example, and contrast. Board copy stays compact; the cues carry the teaching.
- Display types are peers. Match the board to the teaching object: callout, accordion, conversation, code, visual, teaching, music, svg_slot, illustration (when enabled), component_slot, or stage. Use math_scene when genuine coordinate interaction is the teaching object; use visual kind bars for small supplied numeric comparisons, not legacy chart components or arbitrary chart data. Use visual for abstract relationships that its four supported forms fully express; use a picture when visible appearance, placement or scene details carry the explanation. svg_slot is the schematic-diagram component for suitable pictures (compiled raw SVG markup: static schematic or completed derivation by default, with lightweight native SVG animation or interaction only when it directly improves the explanation). Never skip a needed diagram to stay on text.
- Use reference context as factual input only. Do not emit citations, footnotes, source labels, or citation markers.

${COURSE_MATERIAL_CHAT_VOICE_RULES}

Author through two tools:
- commit_section_topics: {"introduction":{"text":"..."}?, "topics":[{"id":"t1","title":"..."}]}
- commit_topic_material: {"topicId":"t1","display":{...},"cues":[{"text":"...","targetIds":["display|figure-or-side-id", "..."],"op":"highlight|window"}]}
Display is one atomic figure (callout, accordion, conversation, code, visual, teaching, music, illustration, svg_slot, …) or a stage of 2–4 figures. Use ordinary stage subviews for comparisons; never emit the retired compare block. Match the display to the teaching object rather than ranking types: a definition/example/tip/warning is a callout; a contrast uses multiple ordinary stage figures; optional extra is accordion; dialogue is conversation; source or special text is code; pitch, rhythm, timbre and notation evidence uses playable music; an abstract process/cycle/layer/numeric comparison fully expressed by labels and relationships can use visual; schematic pictures use svg_slot; a picture whose visible scene, appearance or spatial evidence teaches the idea uses illustration when enabled. Give the display and every stage figure, and taught code part a short unique id. A code display is {"type":"code","language":"python|text|…","parts":[{"id":"optional-taught-slice","text":"exact source including newlines"}]}; concatenate parts in order into one board. Leave scaffolding parts without an id. language text is a monospace board for logs, config, or other special text, not only programs. Each cue is one spoken beat of at most three short sentences; cue text remains TTS-only. targetIds lists one or more of those ids so lighting can follow the objects being taught: one id for a single object, two ids to highlight two stage objects, or the display id for the whole board. Do not cap how many cues a topic uses: keep speaking until the idea is clear. A multi-view topic must explain each subview and their relationship — not only read the card titles.
${COURSE_PRESENTATION_INSTRUCTION}
${COURSE_VISUAL_INSTRUCTION}
${COURSE_TEACHING_INSTRUCTION}
${COURSE_MUSIC_INSTRUCTION}
Do not call commit_section_material for new authoring. Use a code block for every runnable snippet and for special text that needs a monospace board. Cue text is spoken prose; inline $...$ that matches the board is allowed. Board labels, points, and other on-screen copy wrap math in $...$.`;

function learnerKnowledgeCourseTeachingBlock(profileBlock: string): string {
  if (!profileBlock.trim()) return "";
  return `Learner-knowledge teaching (course content):
- Use the learner profile above as global context — not material to repeat.
- When introducing new ideas, prefer short bridges from familiar profile knowledge (general skills, major/field, known topics).
- When useful, compose ordinary stage subviews that contrast new material with what the learner already knows ("like X, but…", "unlike Y…", old mental model vs new).
- Skip reteaching profile foundations; help the learner map new ideas onto existing knowledge quickly.`;
}
function stripMathVisualizationFromSelection(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const enabled = Array.isArray(record.enabledCategories)
    ? record.enabledCategories.filter(
        (category) => category !== "math_visualization",
      )
    : record.enabledCategories;
  const mainCategory =
    record.mainCategory === "math_visualization" ? "base" : record.mainCategory;
  return {
    ...record,
    ...(mainCategory !== undefined ? { mainCategory } : {}),
    ...(enabled !== undefined ? { enabledCategories: enabled } : {}),
  };
}

function materialAuthoringSqJson(
  value: string,
  dropMathVisualization = false,
): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    const stripServerPlans = (candidate: unknown): unknown => {
      if (Array.isArray(candidate)) return candidate.map(stripServerPlans);
      if (!candidate || typeof candidate !== "object") return candidate;
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>).flatMap(
          ([key, child]) => {
            if (key === "plannedComponents") return [];
            if (
              dropMathVisualization &&
              (key === "componentSelection" || key === "component_selection")
            ) {
              return [
                [
                  key,
                  stripMathVisualizationFromSelection(stripServerPlans(child)),
                ] as const,
              ];
            }
            return [[key, stripServerPlans(child)] as const];
          },
        ),
      );
    };
    return JSON.stringify(stripServerPlans(parsed));
  } catch {
    return value;
  }
}

export function courseMaterialBlockTarget(isMicroCourse = false): string {
  if (isMicroCourse) {
    return `Micro-course instruction: A micro course explains the entire topic within a single continuous section using concise, easy-to-understand spoken narration. Do not artificially constrain or truncate the explanation to a small block quota. Even if the topic is extensive or multifaceted, cover it completely and coherently within this one section using as many well-structured blocks, headings, displays, and spoken paragraphs as needed (up to generation limit ${COURSE_MATERIAL_GENERATION_BLOCK_LIMIT}). Prioritize clarity, completeness, and intuitive understanding.`;
  }
  return `Author as many short spoken cue paragraphs as needed to teach this section clearly; generation limit ${COURSE_MATERIAL_GENERATION_BLOCK_LIMIT}. Do not stop early to hit a small block quota. Use more small blocks, not fewer huge blocks.`;
}

/** Provider-facing canonical object-envelope material prompt. */
export function buildCourseMaterialJsonPrompt(params: {
  unitTitle: string;
  plan:
    | PlanContext
    | {
        goalBlock: string;
        difficultyBlock: string;
        styleBlock: string;
        languageBlock: string;
        profileBlock: string;
        topicCategory: TopicCategory;
      };
  optionsBlock: string;
  sqJson: string;
  referenceSection: string;
  previousSectionContext?: string;
  sectionBoundaryContext?: string;
  includeImages: boolean;
  isMicroCourse?: boolean;
  componentSelection?: ComponentCategorySelection;
  disabledMaterialComponentTypes?: readonly string[];
  moduleContext?: string;
  teachingSkillBlock?: string;
  omitSurvey?: boolean;
  orientationPreface?: string;
}): string {
  const { plan } = params;
  const readBlock = (value: string | (() => string)): string =>
    typeof value === "function" ? value.call(plan) : value;
  const profileBlock = readBlock(plan.profileBlock);
  const learnerTeachingBlock =
    learnerKnowledgeCourseTeachingBlock(profileBlock);
  const subviewRequirements = courseMaterialSubviewRequirements(
    Boolean(profileBlock.trim()),
  );
  const isRuiyanShadowDev = isDesktopDevRuiyanShadowIllustrationMode(plan);
  const includeImages = isRuiyanShadowDev || params.includeImages;
  const disabledMaterialComponentTypes = isRuiyanShadowDev
    ? [...(params.disabledMaterialComponentTypes ?? []), "math_scene"]
    : params.disabledMaterialComponentTypes;
  const componentSelection =
    params.componentSelection ??
    componentSelectionFromSqJson(params.sqJson, plan.topicCategory);
  const generationPolicy = materialGenerationPolicyFromSelection(
    componentSelection,
    plan.topicCategory,
    includeImages,
    disabledMaterialComponentTypes,
    isRuiyanShadowDev
      ? {
          maxIllustrationCount: 12,
          replaceInLessonVisualsWithIllustrations: true,
        }
      : undefined,
  );
  const langLabel =
    "langCode" in plan && typeof plan.langCode === "string"
      ? getPromptLanguageLabel(plan.langCode as ContentLanguageCode)
      : "Simplified Chinese";

  const imageRule = isRuiyanShadowDev
    ? "Illustration generation is enabled and replaces all SVG diagrams and math_scene components. Do NOT emit svg_slot or math_scene. Keep built-in visual for abstract relationships fully conveyed by its supported forms; choose illustration when pictorial evidence carries the explanation, even for a process or layered subject. Emit illustration blocks for other pictured explanations, function graph, coordinate plot, geometric construction, vector diagram, process flow, concept map, schematic, state comparison, or step derivation. Each illustration prompt must be as detailed as an SVG or math visualization intent: include semantic subject, coordinate axes or layout framing when relevant, composition (reading order, layout placement, flow direction), required visual elements (functions, curves, points, shapes, arrows), connections/relationships, and exact on-image labels."
    : includeImages
      ? "Illustration generation is available. Use an illustration when a raster picture is the teaching object or its visible appearance, spatial context, concrete scene or state changes make the explanation clearer. Pictures are not limited to subjects SVG cannot draw. Use built-in visual only for relationships fully expressed by abstract labels and geometry; use svg_slot for suitable schematic pictures. Do not add decorative pictures."
      : "Do not emit illustration blocks.";
  const illustrationContract = isRuiyanShadowDev
    ? '- {"type":"illustration","caption":"short learner-facing caption in main content language","prompt":"Detailed English image prompt describing the complete visual intent: Subject: (what this picture depicts), Learning goal: (the precise concept explained), Expected insight: (what the learner should notice), Composition: (layout arrangement, reading order, left/right/above/below/center placement, grouping, and flow direction; include coordinate axes, range, or grid when plotting functions/geometry), Required elements: (specific shapes, objects, curves, points, vectors, icons, or nodes and where they sit), Relationships: (how objects connect, point, flow, intersect, or compare), Labels: short visible labels written in the content language (e.g. Labels: 电源 | R1 | R2 or Labels: y=f(x) | 极值点). Do NOT specify colors, backgrounds, frames, or art style (the renderer automatically pins transparent-background light-theme vector graphics)","style":"diagram|process|concept|comparison","aspectRatio":"16:9|4:3|1:1"}'
    : includeImages
      ? '- {"type":"illustration","caption":"...","prompt":"English prompt describing subject, layout, elements, and labels only — no colors, backgrounds, frames, or art style (the renderer pins a fixed light-theme product style)","style":"diagram|process|concept|comparison","aspectRatio":"16:9|4:3|1:1"}'
      : "";

  const plannedComponents = componentSelection.plannedComponents ?? [];
  const inlinePlannedComponents = plannedComponents.filter(
    (component) =>
      !LAB_ACTIVITY_COMPONENT_TYPES.has(component.componentType) &&
      generationPolicy.allowedComponentTypes.includes(component.componentType),
  );
  const labPlannedComponents = plannedComponents.filter((component) =>
    LAB_ACTIVITY_COMPONENT_TYPES.has(component.componentType),
  );
  const matchingRendererGuide = matchingRendererAuthoringGuide(
    componentSelection,
    generationPolicy.allowedComponentTypes,
  );
  const requiresMatchingLab =
    componentSelection.enabledCategories.includes("circuit_lab") ||
    componentSelection.enabledCategories.includes("mechanics_lab") ||
    componentSelection.enabledCategories.includes("chemistry_lab") ||
    labPlannedComponents.some(
      (component) =>
        component.componentType === "circuit_sandbox" ||
        component.componentType === "mechanics_sandbox" ||
        component.componentType === "chemistry_lab",
    );
  const allowMaterialOwnedComponents =
    inlinePlannedComponents.length === 0 &&
    generationPolicy.allowedComponentTypes.length > 0;
  const hasInlinePlannedDisplay = inlinePlannedComponents.length > 0;
  const hasLabPlannedDisplay = labPlannedComponents.length > 0;
  const componentSlotContract = hasInlinePlannedDisplay
    ? '- {"type":"component_slot","slotRef":"supplied component_N","intent":{"setup":"...","learningGoal":"...","expectedInsight":"..."}}'
    : allowMaterialOwnedComponents
      ? '- {"type":"component_slot","componentType":"one allowed type","intent":{"setup":"...","learningGoal":"...","expectedInsight":"..."}}'
      : "";
  const svgSlotContract = isRuiyanShadowDev
    ? ""
    : `- ${COURSE_SVG_SLOT_INTENT_CONTRACT} (choose visualKind from simple_structure, spatial_relationship, state_comparison, or step_derivation; composition, elements, relationships, and labels are required and must describe the actual picture)`;
  const illustrationPeer = includeImages
    ? ", and illustration when a raster picture is the teaching object"
    : "";
  const nativeDisplayPeers = ["visual", "teaching", "music"].filter(type => supportsDisplay(type)).map(type => `, ${type}`).join("");
  const authoredBlocksRule = isRuiyanShadowDev
    ? hasInlinePlannedDisplay
      ? `Author topics with mixed boards. Display types are peers (callout, accordion, conversation, code${nativeDisplayPeers}, stage, supplied component_slot, and illustration when a picture is the teaching object). Do NOT emit svg_slot or math_scene.`
      : allowMaterialOwnedComponents
        ? `Author topics with mixed boards. Display types are peers (callout, accordion, conversation, code${nativeDisplayPeers}, stage, lesson-local component_slot, and illustration when a picture is the teaching object). Do NOT emit svg_slot or math_scene.`
        : `Author topics with mixed boards. Display types are peers (callout, accordion, conversation, code${nativeDisplayPeers}, stage, and illustration when a picture is the teaching object). Do NOT emit svg_slot or math_scene.`
    : hasInlinePlannedDisplay
      ? `Author topics with mixed boards. Display types are peers (callout, accordion, conversation, code${nativeDisplayPeers}, stage, supplied component_slot, and eligible svg_slot${illustrationPeer}). Choose the board that matches the teaching object.`
      : allowMaterialOwnedComponents
        ? `Author topics with mixed boards. Display types are peers (callout, accordion, conversation, code${nativeDisplayPeers}, stage, lesson-local component_slot, and eligible svg_slot${illustrationPeer}). Choose the board that matches the teaching object.`
        : `Author topics with mixed boards. Display types are peers (callout, accordion, conversation, code${nativeDisplayPeers}, stage, and eligible svg_slot${illustrationPeer}). Choose the board that matches the teaching object.`;
  const componentReferenceRule = isRuiyanShadowDev
    ? hasInlinePlannedDisplay
      ? "Keep mixed topic boards. For frozen in-lesson visuals, emit only the supplied component_slot references; use illustration instead of svg_slot or math_scene. Do not emit svg_slot, SVG source, math_scene, inline-check references, check blocks, placeholders, flip cards, component types, or executable complex blocks."
      : allowMaterialOwnedComponents
        ? "For component_slot, emit one allowed componentType and a lesson-local teaching intent; never emit ids, executable component JSON, svg_slot, SVG source, math_scene, inline-check references, check blocks, placeholders, or flip cards."
        : "Do not emit svg_slot, SVG source, math_scene, component references, component slots, inline-check references, check blocks, placeholders, flip cards, component types, or executable complex blocks."
    : hasInlinePlannedDisplay
      ? "Emit only the supplied component_slot references. Do not emit inline-check references, check blocks, placeholders, flip cards, component types, executable complex blocks, or SVG source."
      : allowMaterialOwnedComponents
        ? "For component_slot, emit one allowed componentType and a lesson-local teaching intent; never emit ids, executable component JSON, inline-check references, check blocks, placeholders, flip cards, or SVG source."
        : "Do not emit component references, component slots, inline-check references, check blocks, placeholders, flip cards, component types, executable complex blocks, or SVG source.";
  const plannedDisplayIntents =
    inlinePlannedComponents.length > 0
      ? `\nPlanned in-lesson visuals (the listed slot refs are frozen; the server owns component types and executable data):\n${inlinePlannedComponents
          .map(
            (component, index) =>
              `${index + 1}. slotRef=${component.id}; ${component.componentType} (inline teaching display): ${component.description}`,
          )
          .join(
            "\n",
          )}\nFor each inline teaching display, place exactly one component_slot item immediately after its heading or the preceding display's narration, followed by at least one paragraph that explains it. Use this wire shape: {"type":"component_slot","slotRef":"the supplied component_N","intent":{"setup":"what the learner sees at this exact point","learningGoal":"the precise lesson-local objective","expectedInsight":"what the learner should notice"}}. The intent must be specific to the following explanation.\nNever emit a component type or executable component JSON.`
      : "";
  const labNote = hasLabPlannedDisplay
    ? `\nThe following interactives are compiled later as 会学实验室 items — do not emit component_slot for them: ${labPlannedComponents.map((component) => `${component.componentType} (${component.id})`).join(", ")}.`
    : "";
  const visualAlternative = isRuiyanShadowDev ? "illustration" : "svg_slot";
  const interactiveRequirement =
    inlinePlannedComponents.length > 0
      ? `${inlinePlannedComponents.length} preplanned in-lesson visual(s) will be compiled by the server. Teach the supporting content clearly and position them with only their supplied opaque slotRef; do not emit component types or component JSON.${plannedDisplayIntents}${labNote}`
      : allowMaterialOwnedComponents
        ? `The selected categories expose this in-lesson visual palette: ${
            generationPolicy.allowedComponentTypes
              .filter((type) => !LAB_ACTIVITY_COMPONENT_TYPES.has(type))
              .join(", ") || "none"
          }. ${
            isRuiyanShadowDev
              ? "Use illustration for pictorial evidence, including function graphs and coordinate plots. Use native music when listening or notation is necessary. Do not emit math_scene."
              : `Use math_scene when coordinate interaction is the teaching object; use ${visualAlternative} when a schematic picture is; use another display when that board matches.`
          } There is no separate count quota beyond the overall material block bound. Follow each inline component_slot with at least one narration paragraph. Never emit chart components, lab types, or executable component data.${labNote}`
        : `No component_slot types are enabled for this section. Native displays, including teaching and music on Web/Electron, remain available without component selection. Do not emit component slots or executable complex components.${labNote}`;

  const topicDisplayCatalog = [
    supportsDisplay("music") ? COURSE_MUSIC_DISPLAY_CONTRACT : "",
    supportsDisplay("teaching") ? COURSE_TEACHING_INSTRUCTION : "",
    !supportsDisplay("visual") ? "" : '- {"type":"visual","id":"v","kind":"process|cycle|layers","title":"...","items":[{"id":"a","label":"...","detail":"..."},{"id":"b","label":"..."}]} — 2–5 items; layers list bottom first. For bars use kind bars, unit, and a required numeric value on each item.',
    '- {"type":"callout","id":"...","variant":"tip|warning|definition|example","title":"...?","body":"..."}',
    '- {"type":"accordion","id":"...","title":"...","body":"..."}',
    '- {"type":"conversation","id":"...","turns":[{"speaker":"...","text":"..."},{"speaker":"...","text":"..."}]}',
    '- {"type":"code","id":"...","language":"python|text|...","parts":[{"id":"optional-taught-slice","text":"..."}]}',
    '- {"type":"stage","id":"...","layout":"split-h|split-v|main+rail|stack","figures":[{...},{...}]}',
    illustrationContract,
    componentSlotContract,
    svgSlotContract,
  ]
    .filter(Boolean)
    .filter(line => { const type = /"type":"([^"]+)"/.exec(line)?.[1]; return !type || supportsDisplay(type); })
    .join("\n");

  const visualPriorityRule = isRuiyanShadowDev
    ? `- Visual renderer matching: display types are peers — pick the board whose job matches this topic. Callout, accordion, conversation, and code stay available alongside illustration. Illustration replaces svg_slot and math_scene for pictures. Do NOT emit svg_slot, SVG markup, or math_scene. Use illustration when the teaching object is a picture: function plots, coordinate geometry, vector diagrams, parameter curves, process flows, concept maps, static examples, physical ray/path diagrams, simple geometry constructions, simple quantitative comparisons, state comparisons, step procedures, and explanatory schematics. Never skip a needed picture to stay on text. Every illustration block must specify style (diagram|process|concept|comparison) and a detailed English prompt with a complete picture-level brief: subject, composition (reading order, left/right/above/below/center placement, grouping, and arrow/flow direction; coordinate axes/ranges if applicable), required elements, relationships, and a "Labels:" line listing all visible labels in ${langLabel}. Do not add decorative clutter. Follow each illustration immediately with at least one narration paragraph.`
    : `- ${VISUAL_RENDERER_PRIORITY_RULE} Use built-in visual only for abstract processes, cycles, layers and supplied numeric comparisons that do not need meaningful pictorial evidence. For other pictures use svg_slot when the teaching object is a schematic of kind simple_structure (including process flows, hierarchies, and concept maps), spatial_relationship (a few objects whose placement matters), state_comparison (two or three schematic states), or step_derivation (2-5 animated geometric or procedural steps). Static kinds compile to one picture with no step UI. There is no fixed SVG or math_scene count; use as many distinct useful in-lesson visuals as the section genuinely needs, while avoiding redundant or decorative ones. Do not emit legacy chart components or arbitrary chart data; bounded visual bars with supplied values are allowed. Never use svg_slot for a person, human body or body part, anatomy, hand or fingers, face, animal, organic natural form, a scene or object whose recognizable realistic silhouette is essential, texture, atmosphere, rich illustration, or anything needing lab interaction. Every svg_slot intent must declare visualKind, fit that category literally, and describe only basic shapes, arrows, and short labels. It must also freeze a picture-level brief: composition (reading order, left/right/above/below/center placement, grouping, and arrow or flow direction), plus specific elements, relationships, and labels so a later redraw stays the same picture. Add avoid when a misconception or extra object would distort the diagram. Do not add decorative or speculative details. Follow it immediately with at least one narration paragraph. Never write SVG markup or executable diagram JSON in this call; a separate server call draws it.`;

  return `${presentationCapabilityInstruction(includeImages) ? presentationCapabilityInstruction(includeImages) + "\n\n" : ""}${params.orientationPreface ? `${params.orientationPreface}\n\n` : ""}Create the interactive course for unit "${params.unitTitle}".
${params.isMicroCourse ? "This is the complete continuous micro course. Teach the entire topic within this single section using concise yet easy-to-understand spoken narration. Do not artificially limit or cut short the explanation if the topic is extensive; use headings to structure the reading flow without presenting them as separate course sections." : params.omitSurvey ? "This is the single orientation teaching section for the goal. Do not invent a Survey or practice steps." : "This is one focused teaching section inside the unit."}
Stay inside THIS unit only; do not teach sibling-unit topics.
${UNIT_SHARED_CONTEXT_REUSE_LINE}
${courseMaterialBlockTarget(params.isMicroCourse)}
${params.moduleContext ? `${params.moduleContext}\n` : ""}
${params.teachingSkillBlock ? `${params.teachingSkillBlock}\n` : ""}${isRuiyanShadowDev ? `${RUIYAN_SHADOW_DEV_VISUAL_OVERRIDE}\n` : ""}
${params.sectionBoundaryContext ? `Unit section boundary map (authoritative):\n${params.sectionBoundaryContext}\nTreat the listed sections as a partition of the unit, not as alternate retellings of the same lesson. Teach only the CURRENT section's planned focus. Other sections are exclusion boundaries: do not explain their main concepts, examples, arguments, or conclusions here. Mention a prerequisite from another section only in one short reminder when indispensable; do not recap it.\n` : ""}
${params.previousSectionContext ? `Previous section continuity context (bounded):\n${params.previousSectionContext}\nUse this only to make a brief transition when useful and to avoid repeating explanations. Do not expand this section's scope, copy the prior section, or assume the learner mastered it.\n` : ""}

Must include:
${
  params.omitSurvey
    ? `- This orientation section has no Survey. Do not call commit_component_selection or invent a component palette, checkpoints, or learning-target ids.
- ${interactiveRequirement}`
    : `- Primary teaching-mode hint selected during survey: ${componentSelection.mainCategory}. ${
        requiresMatchingLab
          ? `Enabled lab families will be compiled as 会学实验室 after this lesson. Teach the supporting prose here; do not replace a lab with ${visualAlternative}.`
          : inlinePlannedComponents.length > 0
            ? "Frozen in-lesson visual slots are server-owned and must be taught."
            : "This hint and enabledCategories are a palette, not a quota: still pick svg_slot, math_scene, or another board when that is the matching teaching object."
      }
${matchingRendererGuide ? `- ${matchingRendererGuide.replaceAll("\n", "\n  ")}\n` : ""}- ${interactiveRequirement}`
}
${visualPriorityRule}
- ${subviewRequirements}
- ${imageRule}
${readBlock(plan.goalBlock)}
${readBlock(plan.difficultyBlock)}
${readBlock(plan.styleBlock)}
${learnerTeachingBlock ? `\n${learnerTeachingBlock}\n` : ""}${params.optionsBlock ? `\n${params.optionsBlock}\n` : ""}${readBlock(plan.languageBlock)}

Commit through the authoring tools, not a section-wide items envelope. commit_section_topics owns the optional introduction and topic titles. Each commit_topic_material display is exactly one of these boards — they are peers; pick the one that matches the teaching object:
${topicDisplayCatalog}

Rules:
- ${authoredBlocksRule} Each topic is one display plus spoken cues; never encode the display as a JSON string or combine two boards in one display.
- Do not emit item-wrapper kind fields or block wrappers; visual.kind is the bounded component selector. Do not emit sibling introduction/blocks/keyTakeaways fields.
- ${componentReferenceRule}

${params.omitSurvey ? "This lesson has no Survey preview. Do not invent guiding questions, checkpoints, or learning-target ids." : `SQ preview: ${compactSqJsonArg(materialAuthoringSqJson(params.sqJson, isRuiyanShadowDev))}`}

Reference context:
${params.referenceSection}`;
}
