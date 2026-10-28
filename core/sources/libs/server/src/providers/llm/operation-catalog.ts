import {
  CAPABILITY_PROMPT_LAYER_ORDER,
  type CapabilityContextSemanticClass,
  type CapabilityPromptLayer,
  type EagerViewProfile,
  type GenerationContextProfile,
  type LazyToolProfile,
} from "../../learning-systems/types.js";
export { CAPABILITY_PROMPT_LAYER_ORDER } from "../../learning-systems/types.js";
import { BASE_CAPABILITY_VIEW_KEYS } from "../../learning-systems/keys.js";
import { AGENT_CORE_VIEW_KEYS } from "../../agents/core/keys.js";
import { ASSISTANT_POLICY_VIEW_KEYS } from "../../learning-systems/capabilities/assistant-policy/keys.js";
import { GOAL_CREATION_VIEW_KEYS } from "../../agents/goal-creation/keys.js";
import { TITLE_REFINEMENT_VIEW_KEYS } from "../../goals/title-refinement-keys.js";
import { MATERIAL_FOLLOW_UP_VIEW_KEYS } from "../../agents/material-follow-up/keys.js";
import { CURRICULUM_PLANNING_VIEW_KEYS } from "../../llm/curriculum-planning-keys.js";
import { TEACHING_SKILL_VIEW_KEYS } from "../../teaching-skills/keys.js";
import { MAP_REFINEMENT_VIEW_KEYS } from "../../llm/map-refinement-keys.js";
import { GOAL_SUMMARY_VIEW_KEYS } from "../../llm/goal-summary-keys.js";
import { GOAL_COURSE_PATTERN_VIEW_KEYS } from "../../llm/goal-course-pattern-keys.js";
import { MICRO_UNIT_VIEW_KEYS } from "../../llm/micro-unit-keys.js";
import { MICRO_TITLE_VIEW_KEYS } from "../../goals/micro-title-keys.js";
import { OVERVIEW_COURSE_VIEW_KEYS } from "../../goals/overview-course-keys.js";
import { MODULE_CURRICULUM_VIEW_KEYS } from "../../llm/module-curriculum-keys.js";
import { GOAL_MAP_VIEW_KEYS } from "../../llm/decompose-keys.js";
import { MAP_EXPANSION_VIEW_KEYS } from "../../llm/map-expansion-keys.js";
import { COGNITIVE_MODEL_VIEW_KEYS } from "../../learning-systems/capabilities/kacom-generation-keys.js";
import { UNIT_CONTENT_VIEW_KEYS } from "../../learning-systems/capabilities/unit-content/keys.js";
import { MATERIAL_COMPONENT_VIEW_KEYS } from "../../learning-systems/capabilities/material-components/keys.js";
import { SCENARIO_THEATER_GENERATION_VIEW_KEYS } from "../../learning-systems/capabilities/scenario-theater.js";
import { ASSESSMENT_GENERATION_VIEW_KEYS } from "../../learning-systems/capabilities/assessment-generation-keys.js";
import { TEACHING_DIALOGUE_VIEW_KEYS } from "../../learning-systems/capabilities/teaching-dialogue/keys.js";
import { AGENDA_GENERATION_VIEW_KEYS } from "../../learning-systems/capabilities/agenda.js";
import { GENERAL_MEMORY_VIEW_KEYS } from "../../learning-systems/capabilities/general-memory/keys.js";
import { LEARNING_SPACES_VIEW_KEYS } from "../../learning-systems/capabilities/learning-spaces.js";
import { FORMAL_DERIVATION_VIEW_KEYS } from "../../learning-systems/capabilities/formal-derivation/keys.js";
import { TEACHING_DERIVATION_VIEW_KEYS } from "../../learning-systems/capabilities/teaching-derivation/keys.js";


export const DEFAULT_LLM_OPERATION_KEY = "__default__" as const;

export type LlmOperationCategory =
  | "agents"
  | "planning"
  | "cognition"
  | "content"
  | "assessment"
  | "memory"
  | "other";

export type LlmOperationDefinition = {
  key: string;
  label: string;
  category: LlmOperationCategory;
  /** Code-owned behavior used only when admin routing says `inherit`. */
  defaultReasoning: boolean;
  /**
   * Code-owned context policy. Routing retries and structured repairs inherit
   * this profile from their canonical logical operation.
   */
  contextProfile: GenerationContextProfile;
};

export type LlmOperationDefinitionInput = Omit<
  LlmOperationDefinition,
  "contextProfile"
> & {
  contextProfile?: GenerationContextProfile;
  /** Keep internal extraction calls isolated from learner/persona context. */
  inheritBaseContext?: boolean;
  /** Interactive replies may address the learner via the render-time token. */
  includeLearnerNamePlaceholder?: boolean;
  /** Learner-facing Markdown/math/code/pronunciation markup. */
  includeContentMarkup?: boolean;
};

export const LEARNING_SYSTEM_VIEW_KEYS = Object.freeze({
  goalIntent: "goal.intent.v1",
  curriculumStructure: "curriculum.structure.v1",
  sessionCurrent: "session.current.v1",
  contentMaterial: "content.material.v1",
  learnerRelevantMemory: GENERAL_MEMORY_VIEW_KEYS.learnerRelevantMemory,
  ragSources: "rag.sources.v1",
  learnerProfile: "learner.profile.v1",
  teachingPersonaBase: "teaching.persona.base.v1",
  teachingPersonaFull: "teaching.persona.full.v1",
  teachingPersonaCourse: "teaching.persona.course.v1",
  teachingPersonaAssessment: "teaching.persona.assessment.v1",
  teachingPersonaFollowUp: "teaching.persona.follow_up.v1",
  teachingDomainGuidance: "teaching.domain_guidance.v1",
  learningObjectives: "learning.objectives.v1",
  learningAssessmentAuthority: "learning.assessment_authority.v1",
  learnerCognitiveState: "learner.cognitive_state.v1",
  agendaCurrent: "agenda.current.v1",
  reviewDue: "review.due.v1",
  assessmentHistory: "assessment.history.v1",
  scenarioTheaterCurrent: "scenario_theater.current.v1",
  globalAssistantInstruction: ASSISTANT_POLICY_VIEW_KEYS.instruction,
  globalAssistantCurrentContext: ASSISTANT_POLICY_VIEW_KEYS.currentContext,
  userFacingResponseLanguage:
    BASE_CAPABILITY_VIEW_KEYS.userFacingResponseLanguage,
  agentSystemRules: AGENT_CORE_VIEW_KEYS.systemRules,
  agentAwareness: AGENT_CORE_VIEW_KEYS.awareness,
  agentResumeContext: AGENT_CORE_VIEW_KEYS.resumeContext,
  goalCreationIntakeInstruction: GOAL_CREATION_VIEW_KEYS.intakeInstruction,
  goalCreationScopeInstruction: GOAL_CREATION_VIEW_KEYS.scopeInstruction,
  goalCreationPlanInstruction: GOAL_CREATION_VIEW_KEYS.planInstruction,
  goalCreationProfileSufficiency: GOAL_CREATION_VIEW_KEYS.profileSufficiency,
  goalCreationCurrentTime: GOAL_CREATION_VIEW_KEYS.currentTime,
  goalCreationConfirmedContract: GOAL_CREATION_VIEW_KEYS.confirmedContract,
  goalCreationFrozenBlueprint: GOAL_CREATION_VIEW_KEYS.frozenBlueprint,
  goalModuleStructureAuditInstruction:
    GOAL_CREATION_VIEW_KEYS.moduleAuditInstruction,
  goalCreationLearningSpace: LEARNING_SPACES_VIEW_KEYS.goalCreationContext,
  curriculumModule: "curriculum.module.v1",
  curriculumUnit: "curriculum.unit.v1",
  documentTopicInstruction: GOAL_CREATION_VIEW_KEYS.documentTopicInstruction,
  topicSummaryInstruction: TITLE_REFINEMENT_VIEW_KEYS.instruction,
  materialFollowUpInstructionContext:
    MATERIAL_FOLLOW_UP_VIEW_KEYS.instructionContext,
  curriculumPlanningInstructionContext:
    CURRICULUM_PLANNING_VIEW_KEYS.journeyInstructionContext,
  goalPlanDetailInstructionContext:
    CURRICULUM_PLANNING_VIEW_KEYS.detailInstructionContext,
  teachingSkillSelectionInstruction:
    TEACHING_SKILL_VIEW_KEYS.selectionInstruction,
  mapRefinementInstructionContext: MAP_REFINEMENT_VIEW_KEYS.instructionContext,
  goalSummaryInstructionContext: GOAL_SUMMARY_VIEW_KEYS.instructionContext,
  goalCoursePatternInstructionContext:
    GOAL_COURSE_PATTERN_VIEW_KEYS.instructionContext,
  microUnitInstructionContext: MICRO_UNIT_VIEW_KEYS.instructionContext,
  microTitleBroadenInstructionContext:
    MICRO_TITLE_VIEW_KEYS.broadenInstructionContext,
  overviewCourseInstructionContext:
    OVERVIEW_COURSE_VIEW_KEYS.instructionContext,
  moduleCapabilitiesInstructionContext:
    MODULE_CURRICULUM_VIEW_KEYS.capabilitiesInstructionContext,
  moduleStructureInstructionContext:
    MODULE_CURRICULUM_VIEW_KEYS.structureInstructionContext,
  moduleExplorationStructureInstructionContext:
    MODULE_CURRICULUM_VIEW_KEYS.explorationStructureInstructionContext,
  moduleKacomAuditInstructionContext:
    MODULE_CURRICULUM_VIEW_KEYS.auditInstructionContext,
  goalMapInstructionContext: GOAL_MAP_VIEW_KEYS.instructionContext,
  mapExpandBranchInstructionContext:
    MAP_EXPANSION_VIEW_KEYS.branchInstructionContext,
  mapSubdivideInstructionContext:
    MAP_EXPANSION_VIEW_KEYS.subdivideInstructionContext,
  cognitiveModelUnitInstructionContext:
    COGNITIVE_MODEL_VIEW_KEYS.unitInstructionContext,
  cognitiveModelTargetFirstInstructionContext:
    COGNITIVE_MODEL_VIEW_KEYS.targetFirstInstructionContext,
  cognitiveModelTargetPrefixInstructionContext:
    COGNITIVE_MODEL_VIEW_KEYS.targetPrefixInstructionContext,
  cognitiveModelTargetSuffixInstructionContext:
    COGNITIVE_MODEL_VIEW_KEYS.targetSuffixInstructionContext,
  unitSqPreviewInstructionContext:
    UNIT_CONTENT_VIEW_KEYS.sqPreviewInstructionContext,
  unitAuthoringAgentInstructionContext:
    UNIT_CONTENT_VIEW_KEYS.authoringAgentInstructionContext,
  unitSectionPlanInstructionContext:
    UNIT_CONTENT_VIEW_KEYS.sectionPlanInstructionContext,
  unitSqAnswersInstructionContext:
    UNIT_CONTENT_VIEW_KEYS.sqAnswersInstructionContext,
  unitMaterialInstructionContext:
    UNIT_CONTENT_VIEW_KEYS.materialInstructionContext,
  materialComponentSelectionInstructionContext:
    MATERIAL_COMPONENT_VIEW_KEYS.selectionInstructionContext,
  materialComponentPolicyContext: MATERIAL_COMPONENT_VIEW_KEYS.policyContext,
  materialInlineCheckInstructionContext:
    MATERIAL_COMPONENT_VIEW_KEYS.inlineCheckInstructionContext,
  materialComponentCompileInstructionContext:
    MATERIAL_COMPONENT_VIEW_KEYS.compileInstructionContext,
  materialSvgInstructionContext:
    MATERIAL_COMPONENT_VIEW_KEYS.svgInstructionContext,
  materialSvgVisualAuditInstructionContext:
    MATERIAL_COMPONENT_VIEW_KEYS.svgVisualAuditInstructionContext,
  materialGuidedImageSegmentInstructionContext:
    MATERIAL_COMPONENT_VIEW_KEYS.guidedImageSegmentInstructionContext,
  materialGuidedImageNarrateInstructionContext:
    MATERIAL_COMPONENT_VIEW_KEYS.guidedImageNarrateInstructionContext,
  materialHtmlInstructionContext:
    MATERIAL_COMPONENT_VIEW_KEYS.htmlInstructionContext,
  unitCornellInstructionContext:
    UNIT_CONTENT_VIEW_KEYS.cornellInstructionContext,
  unitKeyPointsInstructionContext:
    UNIT_CONTENT_VIEW_KEYS.keyPointsInstructionContext,
  unitFlashcardsInstructionContext:
    UNIT_CONTENT_VIEW_KEYS.flashcardsInstructionContext,
  scenarioTheaterPrepareInstructionContext:
    SCENARIO_THEATER_GENERATION_VIEW_KEYS.prepareInstructionContext,
  scenarioTheaterSceneInstructionContext:
    SCENARIO_THEATER_GENERATION_VIEW_KEYS.sceneInstructionContext,
  scenarioTheaterFinalizeInstructionContext:
    SCENARIO_THEATER_GENERATION_VIEW_KEYS.finalizeInstructionContext,
  assessmentQuizInstructionContext:
    ASSESSMENT_GENERATION_VIEW_KEYS.quizInstructionContext,
  assessmentFeynmanInstructionContext:
    ASSESSMENT_GENERATION_VIEW_KEYS.feynmanInstructionContext,
  assessmentDrillsInstructionContext:
    ASSESSMENT_GENERATION_VIEW_KEYS.drillsInstructionContext,
  assessmentDiagnosticInstructionContext:
    ASSESSMENT_GENERATION_VIEW_KEYS.diagnosticInstructionContext,
  assessmentAdaptiveEvaluationInstructionContext:
    ASSESSMENT_GENERATION_VIEW_KEYS.adaptiveEvaluationInstructionContext,
  teachingQuizExplainInstructionContext:
    TEACHING_DIALOGUE_VIEW_KEYS.quizExplainInstructionContext,
  teachingSocraticPolicyContext:
    TEACHING_DIALOGUE_VIEW_KEYS.socraticPolicyContext,
  teachingSocraticInstructionContext:
    TEACHING_DIALOGUE_VIEW_KEYS.socraticInstructionContext,
  teachingSocraticFeedbackInstructionContext:
    TEACHING_DIALOGUE_VIEW_KEYS.socraticFeedbackInstructionContext,
  agendaRefineInstructionContext:
    AGENDA_GENERATION_VIEW_KEYS.refineInstructionContext,
  formalDerivationAuthoringInstruction:
    FORMAL_DERIVATION_VIEW_KEYS.authoringInstruction,
  formalDerivationExpansionInstruction:
    FORMAL_DERIVATION_VIEW_KEYS.expansionInstruction,
  teachingDerivationAuthoringInstruction:
    TEACHING_DERIVATION_VIEW_KEYS.authoringInstruction,



} as const);

export const CAPABILITY_QUERY_TOOL_KEYS = Object.freeze({
  getCurrentLearningState: "get_current_learning_state",
  getCurrentLearningObjectives: "get_current_learning_objectives",
  findRelevantMemory: "find_relevant_memory",
  searchKnowledge: "search_knowledge",
  searchIndexedSources: "search_indexed_sources",
  getCurrentAgenda: "get_study_agenda",
  getDueReviews: "get_due_reviews",
  searchGoals: "search_goals",
  searchUnits: "search_units",
  getRecentActivity: "get_recent_activity",
  getActiveGoalCreation: "get_active_goal_creation",
  explainLearningApp: "explain_learning_app",
  getEffectiveLearningPreferences: "get_effective_learning_preferences",
} as const);

const DEFAULT_EAGER_CONTEXT_TOKENS = 12_000;

const PLATFORM_POLICY_VIEWS = new Set<string>([
  BASE_CAPABILITY_VIEW_KEYS.generationPolicy,
  BASE_CAPABILITY_VIEW_KEYS.learnerNamePlaceholderPolicy,
]);

const REUSABLE_GUIDANCE_VIEWS = new Set<string>([
  LEARNING_SYSTEM_VIEW_KEYS.teachingDomainGuidance,
]);

const REUSABLE_FEATURE_POLICY_VIEWS = new Set<string>([
  BASE_CAPABILITY_VIEW_KEYS.contentMarkup,
  LEARNING_SYSTEM_VIEW_KEYS.materialComponentPolicyContext,
  LEARNING_SYSTEM_VIEW_KEYS.materialComponentSelectionInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.materialInlineCheckInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.materialComponentCompileInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.materialSvgInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.materialSvgVisualAuditInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.materialHtmlInstructionContext,
  // Durable unit-authoring rules are shared across Survey / section-plan /
  // material stages of the same agent thread. Keep them with reusable feature
  // policy (before goal/module/unit) so the system prefix stays common-first.
  LEARNING_SYSTEM_VIEW_KEYS.unitAuthoringAgentInstructionContext,
  // Shared Socratic rules for dialogue + feedback repair so both ops reuse one
  // common prefix through unit context before mode-specific invocation text.
  LEARNING_SYSTEM_VIEW_KEYS.teachingSocraticPolicyContext,
  LEARNING_SYSTEM_VIEW_KEYS.lessonPerformanceScriptInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.lessonPerformanceSceneRewriteInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.lessonPerformanceOralizeInstruction,
]);

const LEARNER_CONTEXT_VIEWS = new Set<string>([
  LEARNING_SYSTEM_VIEW_KEYS.learnerProfile,
  LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaBase,
  LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaFull,
  LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaCourse,
  LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaAssessment,
  LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaFollowUp,
]);

const GOAL_CONTEXT_VIEWS = new Set<string>([
  LEARNING_SYSTEM_VIEW_KEYS.goalIntent,
  LEARNING_SYSTEM_VIEW_KEYS.goalCreationConfirmedContract,
  LEARNING_SYSTEM_VIEW_KEYS.goalCreationFrozenBlueprint,
  LEARNING_SYSTEM_VIEW_KEYS.curriculumStructure,
  LEARNING_SYSTEM_VIEW_KEYS.goalCreationLearningSpace,
]);

const MODULE_CONTEXT_VIEWS = new Set<string>([
  LEARNING_SYSTEM_VIEW_KEYS.curriculumModule,
]);

const UNIT_CONTEXT_VIEWS = new Set<string>([
  LEARNING_SYSTEM_VIEW_KEYS.curriculumUnit,
  LEARNING_SYSTEM_VIEW_KEYS.learningObjectives,
  LEARNING_SYSTEM_VIEW_KEYS.learningAssessmentAuthority,
]);

const OPERATION_INSTRUCTION_VIEWS = new Set<string>([
  LEARNING_SYSTEM_VIEW_KEYS.agentSystemRules,
  LEARNING_SYSTEM_VIEW_KEYS.globalAssistantInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.goalCreationIntakeInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.goalCreationScopeInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.goalCreationPlanInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.goalCreationProfileSufficiency,
  LEARNING_SYSTEM_VIEW_KEYS.documentTopicInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.topicSummaryInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.materialFollowUpInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.curriculumPlanningInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.goalPlanDetailInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.teachingSkillSelectionInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.mapRefinementInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.goalSummaryInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.goalCoursePatternInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.microUnitInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.microTitleBroadenInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.overviewCourseInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.moduleCapabilitiesInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.moduleStructureInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.moduleExplorationStructureInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.moduleKacomAuditInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.goalModuleStructureAuditInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.goalMapInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.mapExpandBranchInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.mapSubdivideInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.cognitiveModelUnitInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.cognitiveModelTargetFirstInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.cognitiveModelTargetPrefixInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.cognitiveModelTargetSuffixInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.unitSqPreviewInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.unitSectionPlanInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.unitSqAnswersInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.unitMaterialInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.materialGuidedImageSegmentInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.materialGuidedImageNarrateInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.unitCornellInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.unitKeyPointsInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.unitFlashcardsInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.scenarioTheaterPrepareInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.scenarioTheaterSceneInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.scenarioTheaterFinalizeInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.assessmentQuizInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.assessmentFeynmanInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.assessmentDrillsInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.assessmentDiagnosticInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.assessmentAdaptiveEvaluationInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.teachingQuizExplainInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.teachingSocraticInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.teachingSocraticFeedbackInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.agendaRefineInstructionContext,
  LEARNING_SYSTEM_VIEW_KEYS.formalDerivationAuthoringInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.formalDerivationExpansionInstruction,
  LEARNING_SYSTEM_VIEW_KEYS.teachingDerivationAuthoringInstruction,
]);

const VOLATILE_CONTEXT_VIEWS = new Set<string>([
  LEARNING_SYSTEM_VIEW_KEYS.sessionCurrent,
  LEARNING_SYSTEM_VIEW_KEYS.contentMaterial,
  LEARNING_SYSTEM_VIEW_KEYS.learnerRelevantMemory,
  LEARNING_SYSTEM_VIEW_KEYS.learnerCognitiveState,
  LEARNING_SYSTEM_VIEW_KEYS.agendaCurrent,
  LEARNING_SYSTEM_VIEW_KEYS.reviewDue,
  LEARNING_SYSTEM_VIEW_KEYS.ragSources,
  LEARNING_SYSTEM_VIEW_KEYS.assessmentHistory,
  LEARNING_SYSTEM_VIEW_KEYS.scenarioTheaterCurrent,
  LEARNING_SYSTEM_VIEW_KEYS.agentAwareness,
  LEARNING_SYSTEM_VIEW_KEYS.agentResumeContext,
  LEARNING_SYSTEM_VIEW_KEYS.globalAssistantCurrentContext,
  LEARNING_SYSTEM_VIEW_KEYS.goalCreationCurrentTime,
  LEARNING_SYSTEM_VIEW_KEYS.userFacingResponseLanguage,
]);

const PROMPT_LAYER_BY_VIEW = new Map<string, CapabilityPromptLayer>([
  ...[...PLATFORM_POLICY_VIEWS].map((key) => [key, "platform_policy"] as const),
  ...[...LEARNER_CONTEXT_VIEWS].map((key) => [key, "learner_context"] as const),
  ...[...REUSABLE_GUIDANCE_VIEWS].map(
    (key) => [key, "reusable_guidance"] as const,
  ),
  ...[...REUSABLE_FEATURE_POLICY_VIEWS].map(
    (key) => [key, "reusable_feature_policy"] as const,
  ),
  ...[...GOAL_CONTEXT_VIEWS].map((key) => [key, "goal_context"] as const),
  ...[...MODULE_CONTEXT_VIEWS].map((key) => [key, "module_context"] as const),
  ...[...UNIT_CONTEXT_VIEWS].map((key) => [key, "unit_context"] as const),
  ...[...OPERATION_INSTRUCTION_VIEWS].map(
    (key) => [key, "operation_instruction"] as const,
  ),
  ...[...VOLATILE_CONTEXT_VIEWS].map(
    (key) => [key, "volatile_context"] as const,
  ),
]);

export type HostPromptViewDefinition = Readonly<{ key: string; promptLayer: CapabilityPromptLayer; semanticClass: CapabilityContextSemanticClass; promptOrder?: number }>;
const hostPromptViews = new Map<string, HostPromptViewDefinition>();
const hostPromptOwners = new Map<string, readonly HostPromptViewDefinition[]>();
/** Register trusted host-owned view metadata before compiling its operation profiles. */
export function registerHostPromptViews(ownerId: string, views: readonly HostPromptViewDefinition[]): void {
  const previous = hostPromptOwners.get(ownerId);
  if (previous && JSON.stringify(previous) === JSON.stringify(views)) return;
  if (previous) throw new Error(`Host prompt owner ${ownerId} is already registered`);
  const keys = new Set<string>();
  for (const view of views) {
    if (!view.key.trim() || keys.has(view.key) || PROMPT_LAYER_BY_VIEW.has(view.key) || hostPromptViews.has(view.key)) throw new Error(`Duplicate prompt view ${view.key}`);
    if (!CAPABILITY_PROMPT_LAYER_ORDER.includes(view.promptLayer)) throw new Error(`Unsupported prompt layer ${view.promptLayer}`);
    keys.add(view.key);
  }
  for (const view of views) hostPromptViews.set(view.key, {...view});
  hostPromptOwners.set(ownerId, views.map(view => ({...view})));
}

function semanticClassForView(key: string): CapabilityContextSemanticClass {
  const host = hostPromptViews.get(key); if (host) return host.semanticClass;
  if (PLATFORM_POLICY_VIEWS.has(key)) return "platform_policy";
  if (LEARNER_CONTEXT_VIEWS.has(key)) return "teacher_context";
  if (REUSABLE_GUIDANCE_VIEWS.has(key)) return "domain_teaching_guidance";
  if (REUSABLE_FEATURE_POLICY_VIEWS.has(key)) return "feature_policy";
  if (GOAL_CONTEXT_VIEWS.has(key)) return "goal_projection";
  if (MODULE_CONTEXT_VIEWS.has(key)) return "module_projection";
  if (UNIT_CONTEXT_VIEWS.has(key)) return "unit_projection";
  if (OPERATION_INSTRUCTION_VIEWS.has(key)) return "operation_instruction";
  if (VOLATILE_CONTEXT_VIEWS.has(key)) return "volatile_context";
  throw new Error(`Eager capability view "${key}" has no semantic class`);
}

// Keep the teacher's relatively stable behavior before learner-authored
// profile data. Explicit order avoids moving the cache boundary when a view
// key is renamed.
const PROMPT_ORDER_BY_VIEW = new Map<string, number>([
  [LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaBase, 100],
  [LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaFull, 100],
  [LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaCourse, 100],
  [LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaAssessment, 100],
  [LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaFollowUp, 100],
  [LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 200],
  [LEARNING_SYSTEM_VIEW_KEYS.goalCreationConfirmedContract, 100],
  [LEARNING_SYSTEM_VIEW_KEYS.goalCreationFrozenBlueprint, 200],
]);

function promptLayerForView(key: string): CapabilityPromptLayer {
  const layer = PROMPT_LAYER_BY_VIEW.get(key) ?? hostPromptViews.get(key)?.promptLayer;
  if (!layer) {
    throw new Error(`Eager capability view "${key}" has no prompt layer`);
  }
  return layer;
}

function promptOrderForView(key: string): number {
  return PROMPT_ORDER_BY_VIEW.get(key) ?? hostPromptViews.get(key)?.promptOrder ?? 1_000;
}

function sortEagerViews(views: EagerViewProfile[]): EagerViewProfile[] {
  const layerIndex = new Map(
    CAPABILITY_PROMPT_LAYER_ORDER.map((layer, index) => [layer, index]),
  );
  return [...views].sort((left, right) => {
    const byLayer =
      (left.promptLayer
        ? (layerIndex.get(left.promptLayer) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER) -
      (right.promptLayer
        ? (layerIndex.get(right.promptLayer) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER);
    const byPromptOrder =
      (left.promptOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.promptOrder ?? Number.MAX_SAFE_INTEGER);
    return byLayer || byPromptOrder || left.key.localeCompare(right.key);
  });
}

export function eagerView(
  key: string,
  maxTokens: number,
  options: { required?: boolean; allowStale?: boolean } = {},
): EagerViewProfile {
  return {
    key,
    required: options.required ?? false,
    allowStale: options.allowStale ?? false,
    maxTokens,
    promptLayer: promptLayerForView(key),
    promptOrder: promptOrderForView(key),
    semanticClass: semanticClassForView(key),
  };
}

function lazyTool(
  key: string,
  maxCalls: number,
  maxResultTokens: number,
): LazyToolProfile {
  return { key, maxCalls, maxResultTokens };
}

export function profile(
  options: {
    eagerViews?: EagerViewProfile[];
    lazyTools?: LazyToolProfile[];
    maxEagerContextTokens?: number;
    maxLazyContextTokens?: number;
    maxToolRounds?: number;
  } = {},
): GenerationContextProfile {
  return {
    eagerViews: sortEagerViews(options.eagerViews ?? []),
    lazyTools: options.lazyTools ?? [],
    maxEagerContextTokens:
      options.maxEagerContextTokens ?? DEFAULT_EAGER_CONTEXT_TOKENS,
    maxLazyContextTokens: options.maxLazyContextTokens ?? 0,
    maxToolRounds: options.maxToolRounds ?? 0,
  };
}

const baseContextProfile = profile({
  eagerViews: [
    eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, {
      required: true,
      allowStale: true,
    }),
    // Learner-declared background is useful to every learner-scoped text
    // generation. Calls without a userId receive no contribution, while
    // specialized profiles may replace this entry with a larger token budget.
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 1_000, {
      allowStale: true,
    }),
    // Keep the complete teacher prompt byte-identical across learner-facing
    // operations so provider prefix caches can reuse it across scene types.
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaFull, 2_400, {
      allowStale: true,
    }),
  ],
  maxEagerContextTokens: 3_900,
});

function inheritBaseContextProfile(
  specialized: GenerationContextProfile,
): GenerationContextProfile {
  const eagerViews = new Map(
    baseContextProfile.eagerViews.map((view) => [view.key, view]),
  );
  for (const view of specialized.eagerViews) eagerViews.set(view.key, view);
  const lazyTools = new Map(
    baseContextProfile.lazyTools.map((tool) => [tool.key, tool]),
  );
  for (const tool of specialized.lazyTools) lazyTools.set(tool.key, tool);
  return {
    eagerViews: sortEagerViews([...eagerViews.values()]),
    lazyTools: [...lazyTools.values()],
    maxEagerContextTokens:
      baseContextProfile.maxEagerContextTokens +
      specialized.maxEagerContextTokens,
    maxLazyContextTokens:
      baseContextProfile.maxLazyContextTokens +
      specialized.maxLazyContextTokens,
    maxToolRounds: Math.max(
      baseContextProfile.maxToolRounds,
      specialized.maxToolRounds,
    ),
  };
}

function includeContentMarkupPolicy(
  contextProfile: GenerationContextProfile,
): GenerationContextProfile {
  if (
    contextProfile.eagerViews.some(
      (view) => view.key === BASE_CAPABILITY_VIEW_KEYS.contentMarkup,
    )
  ) {
    return contextProfile;
  }
  return {
    ...contextProfile,
    eagerViews: sortEagerViews([
      eagerView(BASE_CAPABILITY_VIEW_KEYS.contentMarkup, 1_200, {
        required: true,
        allowStale: true,
      }),
      ...contextProfile.eagerViews,
    ]),
    maxEagerContextTokens: contextProfile.maxEagerContextTokens + 1_200,
  };
}

function includeMaterialComponentPolicy(
  contextProfile: GenerationContextProfile,
): GenerationContextProfile {
  if (
    contextProfile.eagerViews.some(
      (view) =>
        view.key === LEARNING_SYSTEM_VIEW_KEYS.materialComponentPolicyContext,
    )
  ) {
    return contextProfile;
  }
  return {
    ...contextProfile,
    eagerViews: sortEagerViews([
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.materialComponentPolicyContext, 500, {
        required: true,
        allowStale: true,
      }),
      ...contextProfile.eagerViews,
    ]),
    maxEagerContextTokens: contextProfile.maxEagerContextTokens + 500,
  };
}

function includeLearnerNamePlaceholderPolicy(
  contextProfile: GenerationContextProfile,
): GenerationContextProfile {
  if (
    contextProfile.eagerViews.some(
      (view) =>
        view.key === BASE_CAPABILITY_VIEW_KEYS.learnerNamePlaceholderPolicy,
    )
  ) {
    return contextProfile;
  }
  return {
    ...contextProfile,
    eagerViews: sortEagerViews([
      eagerView(BASE_CAPABILITY_VIEW_KEYS.learnerNamePlaceholderPolicy, 250, {
        required: true,
        allowStale: true,
      }),
      ...contextProfile.eagerViews,
    ]),
    maxEagerContextTokens: contextProfile.maxEagerContextTokens + 250,
  };
}

function defaultContextProfile(
  category: LlmOperationCategory,
): GenerationContextProfile {
  switch (category) {
    case "planning":
      return profile({
        eagerViews: [
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalIntent, 2_000),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 1_500, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.ragSources, 4_000),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.teachingDomainGuidance, 2_000, {
            allowStale: true,
          }),
        ],
      });
    case "cognition":
      return profile({
        eagerViews: [
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalIntent, 1_500),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.curriculumModule, 2_000, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.curriculumUnit, 1_500, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.ragSources, 4_000),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 1_000, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.teachingDomainGuidance, 1_500, {
            allowStale: true,
          }),
        ],
      });
    case "content":
      return profile({
        eagerViews: [
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.curriculumModule, 2_000, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.curriculumUnit, 1_500, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.sessionCurrent, 2_000),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.ragSources, 3_000),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.learningObjectives, 2_500, {
            required: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.teachingDomainGuidance, 1_500, {
            allowStale: true,
          }),
        ],
      });
    case "assessment":
      return profile({
        eagerViews: [
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.curriculumModule, 2_000, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.curriculumUnit, 1_500, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.sessionCurrent, 2_000),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.contentMaterial, 4_000),
          // A unit can legitimately expose several targets with rubric criteria
          // and dimension requirements. Keep the complete owner-compacted
          // objective definitions instead of rejecting normal assessment plans.
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.learningObjectives, 8_000, {
            required: true,
          }),
          eagerView(
            LEARNING_SYSTEM_VIEW_KEYS.learningAssessmentAuthority,
            500,
            { required: true },
          ),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.assessmentHistory, 1_500),
        ],
      });
    case "memory":
      return profile({
        eagerViews: [
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 1_000, {
            allowStale: true,
          }),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.sessionCurrent, 2_000),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.contentMaterial, 4_000),
          eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerCognitiveState, 2_000, {
            allowStale: true,
          }),
        ],
      });
    case "agents":
    case "other":
      return profile();
  }
}

function planningInstructionProfile(instructionKey: string) {
  const base = defaultContextProfile("planning");
  return profile({
    eagerViews: [
      eagerView(instructionKey, 12_000, {
        required: true,
        allowStale: true,
      }),
      ...base.eagerViews,
    ],
    lazyTools: base.lazyTools,
    maxEagerContextTokens: 24_000,
    maxLazyContextTokens: base.maxLazyContextTokens,
    maxToolRounds: base.maxToolRounds,
  });
}

function moduleAuthoringInstructionProfile(instructionKey: string) {
  const base = planningInstructionProfile(instructionKey);
  const [operationInstruction, ...rest] = base.eagerViews;
  return profile({
    eagerViews: [
      ...(operationInstruction ? [operationInstruction] : []),
      eagerView(
        LEARNING_SYSTEM_VIEW_KEYS.goalCreationConfirmedContract,
        4_000,
        {
          allowStale: true,
        },
      ),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalCreationFrozenBlueprint, 8_000, {
        allowStale: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.curriculumModule, 2_000, {
        allowStale: true,
      }),
      ...rest,
    ],
    lazyTools: base.lazyTools,
    maxEagerContextTokens: 34_000,
    maxLazyContextTokens: base.maxLazyContextTokens,
    maxToolRounds: base.maxToolRounds,
  });
}

function moduleStructureAuditProfile() {
  return profile({
    eagerViews: [
      eagerView(
        LEARNING_SYSTEM_VIEW_KEYS.goalModuleStructureAuditInstruction,
        2_000,
        { required: true, allowStale: true },
      ),
      eagerView(
        LEARNING_SYSTEM_VIEW_KEYS.goalCreationConfirmedContract,
        4_000,
        {
          allowStale: true,
        },
      ),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalCreationFrozenBlueprint, 8_000, {
        allowStale: true,
      }),
    ],
    maxEagerContextTokens: 14_000,
  });
}

function cognitionInstructionProfile(instructionKey: string) {
  const base = defaultContextProfile("cognition");
  return profile({
    eagerViews: [
      eagerView(instructionKey, 20_000, {
        required: true,
        allowStale: true,
      }),
      ...base.eagerViews,
    ],
    lazyTools: base.lazyTools,
    maxEagerContextTokens: 32_000,
    maxLazyContextTokens: base.maxLazyContextTokens,
    maxToolRounds: base.maxToolRounds,
  });
}

/** Unit KACOM already embeds retrieved sources in the prepared prompt. */
function cognitionUnitGenerateInstructionProfile(instructionKey: string) {
  const base = defaultContextProfile("cognition");
  const baseViews = base.eagerViews.filter(
    (view) => view.key !== LEARNING_SYSTEM_VIEW_KEYS.ragSources,
  );
  return profile({
    eagerViews: [
      eagerView(instructionKey, 20_000, {
        required: true,
        allowStale: true,
      }),
      ...baseViews,
    ],
    lazyTools: base.lazyTools,
    maxEagerContextTokens: 28_000,
    maxLazyContextTokens: base.maxLazyContextTokens,
    maxToolRounds: base.maxToolRounds,
  });
}

function contentInstructionProfile(
  instructionKey: string,
  options: { requireLearningObjectives?: boolean } = {},
) {
  const base = defaultContextProfile("content");
  const baseViews = base.eagerViews.map((view) =>
    view.key === LEARNING_SYSTEM_VIEW_KEYS.learningObjectives &&
    options.requireLearningObjectives === false
      ? { ...view, required: false }
      : view,
  );
  return profile({
    eagerViews: [
      eagerView(instructionKey, 20_000, {
        required: true,
        allowStale: true,
      }),
      ...baseViews,
    ],
    lazyTools: base.lazyTools,
    maxEagerContextTokens: 32_000,
    maxLazyContextTokens: base.maxLazyContextTokens,
    maxToolRounds: base.maxToolRounds,
  });
}

function assessmentInstructionProfile(instructionKey: string) {
  const base = defaultContextProfile("assessment");
  return profile({
    eagerViews: [
      eagerView(instructionKey, 16_000, {
        required: true,
        allowStale: true,
      }),
      ...base.eagerViews,
    ],
    lazyTools: base.lazyTools,
    maxEagerContextTokens: 28_000,
    maxLazyContextTokens: base.maxLazyContextTokens,
    maxToolRounds: base.maxToolRounds,
  });
}

function isolatedMemoryInstructionProfile(instructionKey: string) {
  return profile({
    eagerViews: [
      eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, {
        required: true,
        allowStale: true,
      }),
      eagerView(instructionKey, 20_000, {
        required: true,
        allowStale: true,
      }),
    ],
    maxEagerContextTokens: 20_500,
  });
}

/**
 * Identical eager stack for unit.socratic and unit.socratic.feedback so the
 * composed learning-system context stays byte-identical through unit scope;
 * only the appended invocation differs (dialogue turn vs metadata repair).
 */
function socraticDialogueProfile() {
  const base = assessmentInstructionProfile(
    LEARNING_SYSTEM_VIEW_KEYS.teachingSocraticInstructionContext,
  );
  return profile({
    eagerViews: [
      eagerView(
        LEARNING_SYSTEM_VIEW_KEYS.teachingSocraticPolicyContext,
        1_200,
        {
          required: true,
          allowStale: true,
        },
      ),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.agentSystemRules, 1_500, {
        required: true,
        allowStale: true,
      }),
      ...base.eagerViews,
    ],
    lazyTools: base.lazyTools,
    maxEagerContextTokens: base.maxEagerContextTokens + 2_700,
    maxLazyContextTokens: base.maxLazyContextTokens,
    maxToolRounds: base.maxToolRounds,
  });
}

const globalAssistantProfile = profile({
  eagerViews: [
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.agentSystemRules, 1_500, {
      required: true,
      allowStale: true,
    }),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.globalAssistantInstruction, 3_500, {
      required: true,
      allowStale: true,
    }),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.agentAwareness, 1_500),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.globalAssistantCurrentContext, 1_500, {
      required: true,
    }),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.userFacingResponseLanguage, 250, {
      required: true,
    }),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 1_500, {
      allowStale: true,
    }),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaFull, 2_400, {
      allowStale: true,
    }),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.sessionCurrent, 2_000),
  ],
  lazyTools: [
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.getCurrentLearningState, 2, 2_000),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.getCurrentLearningObjectives, 2, 2_000),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.findRelevantMemory, 3, 2_000),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchKnowledge, 3, 3_000),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchIndexedSources, 3, 3_000),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.getCurrentAgenda, 2, 1_500),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.getDueReviews, 2, 1_500),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchGoals, 2, 1_500),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchUnits, 2, 1_500),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.getRecentActivity, 2, 1_200),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.getActiveGoalCreation, 2, 500),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.explainLearningApp, 2, 1_000),
    lazyTool(
      CAPABILITY_QUERY_TOOL_KEYS.getEffectiveLearningPreferences,
      1,
      1_000,
    ),
  ],
  maxEagerContextTokens: 7_450,
  maxLazyContextTokens: 12_000,
  maxToolRounds: 8,
});

function goalCreationIntakeProfile() {
  return profile({
    eagerViews: [
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.agentSystemRules, 1_500, {
        required: true,
        allowStale: true,
      }),
      eagerView(
        LEARNING_SYSTEM_VIEW_KEYS.goalCreationIntakeInstruction,
        4_000,
        {
          required: true,
          allowStale: true,
        },
      ),
      // Intake may search a current-version topic and explicitly relies on the
      // supplied year. Keep date context here, after stable instructions.
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalCreationCurrentTime, 500, {
        required: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.userFacingResponseLanguage, 250, {
        required: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.agentResumeContext, 1_500),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalIntent, 2_000),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 1_500, {
        allowStale: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalCreationLearningSpace, 2_500),
    ],
    lazyTools: [],
    maxEagerContextTokens: 10_750,
    maxLazyContextTokens: 0,
    maxToolRounds: 8,
  });
}

function goalCreationPlanProfile() {
  return profile({
    eagerViews: [
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.agentSystemRules, 1_500, {
        required: true,
        allowStale: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalCreationPlanInstruction, 4_000, {
        required: true,
        allowStale: true,
      }),
      eagerView(
        LEARNING_SYSTEM_VIEW_KEYS.goalCreationProfileSufficiency,
        1_000,
        { required: true, allowStale: true },
      ),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.userFacingResponseLanguage, 250, {
        required: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.agentResumeContext, 1_500),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalIntent, 2_000),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 1_500, {
        allowStale: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerCognitiveState, 2_000, {
        allowStale: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalCreationLearningSpace, 2_500),
    ],
    lazyTools: [
      lazyTool(CAPABILITY_QUERY_TOOL_KEYS.findRelevantMemory, 2, 2_000),
      lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchKnowledge, 4, 3_000),
      lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchIndexedSources, 4, 3_000),
      lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchGoals, 2, 1_500),
    ],
    maxEagerContextTokens: 14_250,
    maxLazyContextTokens: 10_000,
    maxToolRounds: 16,
  });
}

function goalCreationScopeProfile() {
  return profile({
    eagerViews: [
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.agentSystemRules, 1_500, {
        required: true,
        allowStale: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalCreationScopeInstruction, 2_000, {
        required: true,
        allowStale: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.goalCreationCurrentTime, 500, {
        required: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.userFacingResponseLanguage, 250, {
        required: true,
      }),
      eagerView(LEARNING_SYSTEM_VIEW_KEYS.learnerProfile, 1_500, {
        allowStale: true,
      }),
    ],
    lazyTools: [],
    maxEagerContextTokens: 5_750,
    maxLazyContextTokens: 0,
    maxToolRounds: 0,
  });
}

const materialFollowUpAssistantProfile = profile({
  eagerViews: [
    eagerView(
      LEARNING_SYSTEM_VIEW_KEYS.materialFollowUpInstructionContext,
      6_000,
      { required: true },
    ),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.sessionCurrent, 2_000),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.contentMaterial, 5_000),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.teachingPersonaFull, 2_400, {
      allowStale: true,
    }),
    eagerView(LEARNING_SYSTEM_VIEW_KEYS.userFacingResponseLanguage, 250, {
      required: true,
    }),
  ],
  lazyTools: [
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.getCurrentLearningState, 2, 2_000),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.findRelevantMemory, 2, 2_000),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchKnowledge, 2, 3_000),
    lazyTool(CAPABILITY_QUERY_TOOL_KEYS.searchIndexedSources, 2, 3_000),
  ],
  maxEagerContextTokens: 9_650,
  maxLazyContextTokens: 8_000,
  maxToolRounds: 6,
});

const isolatedVerificationProfile = profile({
  eagerViews: [
    eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, {
      required: true,
      allowStale: true,
    }),
  ],
  maxEagerContextTokens: 500,
});

const rawDefinitions: LlmOperationDefinitionInput[] = [
  {
    key: "teaching_persona.preview",
    label: "Teaching persona preview",
    category: "other",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: profile({
      eagerViews: [
        eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, {
          required: true,
          allowStale: true,
        }),
        eagerView(LEARNING_SYSTEM_VIEW_KEYS.userFacingResponseLanguage, 250, {
          required: true,
        }),
      ],
      maxEagerContextTokens: 750,
    }),
  },
  {
    key: "agent.global",
    label: "Global assistant · main",
    category: "agents",
    defaultReasoning: false,
    includeLearnerNamePlaceholder: true,
    contextProfile: globalAssistantProfile,
  },
  {
    key: "agent.goal_creation.intake",
    label: "Goal creation · intake",
    category: "agents",
    defaultReasoning: false,
    contextProfile: goalCreationIntakeProfile(),
  },
  {
    key: "agent.goal_creation.plan",
    label: "Goal creation · plan agent",
    category: "agents",
    defaultReasoning: false,
    contextProfile: goalCreationPlanProfile(),
  },
  {
    key: "agent.goal_creation.scope",
    label: "Goal creation · portfolio scope",
    category: "agents",
    defaultReasoning: true,
    contextProfile: goalCreationScopeProfile(),
  },
  {
    key: "agent.document_topic",
    label: "Document topic extraction",
    category: "agents",
    defaultReasoning: false,
    contextProfile: profile({
      eagerViews: [
        eagerView(LEARNING_SYSTEM_VIEW_KEYS.documentTopicInstruction, 1_000, {
          required: true,
          allowStale: true,
        }),
      ],
      maxEagerContextTokens: 1_000,
    }),
  },
  {
    key: "agent.goal_creation.intent",
    label: "Goal destination and prerequisite intent",
    category: "agents",
    defaultReasoning: true,
    inheritBaseContext: false,
    contextProfile: profile({ eagerViews: [], maxEagerContextTokens: 0 }),
  },
  {
    key: "agent.topic_summary",
    label: "Goal topic summary",
    category: "agents",
    defaultReasoning: false,
    contextProfile: profile({
      eagerViews: [
        eagerView(LEARNING_SYSTEM_VIEW_KEYS.topicSummaryInstruction, 1_000, {
          required: true,
          allowStale: true,
        }),
      ],
      maxEagerContextTokens: 1_000,
    }),
  },
  {
    key: "memory.candidates.extract",
    label: "Memory candidate extraction",
    category: "memory",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: profile({
      eagerViews: [
        eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, {
          required: true,
          allowStale: true,
        }),
      ],
      maxEagerContextTokens: 500,
    }),
  },
  {
    key: "unit.material_follow_up",
    label: "Material follow-up assistant",
    category: "agents",
    defaultReasoning: false,
    includeLearnerNamePlaceholder: true,
    contextProfile: materialFollowUpAssistantProfile,
  },
  {
    key: "goal.curriculum.plan",
    label: "Goal curriculum · fast plan",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.curriculumPlanningInstructionContext,
    ),
  },
  {
    key: "goal.authoring_agent",
    label: "Durable goal authoring agent",
    category: "planning",
    defaultReasoning: true,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.curriculumPlanningInstructionContext,
    ),
  },
  {
    key: "goal.teaching_skill.select",
    label: "Goal teaching skill selection",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.teachingSkillSelectionInstruction,
    ),
  },
  {
    key: "goal.curriculum.plan.deep_blueprint",
    label: "Goal curriculum · deep blueprint",
    category: "planning",
    defaultReasoning: true,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.curriculumPlanningInstructionContext,
    ),
  },
  {
    key: "goal.curriculum.plan.deep_draft",
    label: "Goal curriculum · legacy deep draft",
    category: "planning",
    defaultReasoning: true,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.curriculumPlanningInstructionContext,
    ),
  },
  {
    key: "goal.curriculum.plan.deep_synthesis",
    label: "Goal curriculum · lightweight verification",
    category: "planning",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "goal.plan.detail",
    label: "Goal detailed plan",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.goalPlanDetailInstructionContext,
    ),
  },
  {
    key: "goal.map",
    label: "Goal map",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.goalMapInstructionContext,
    ),
  },
  {
    key: "goal.map.refresh",
    label: "Goal map refresh",
    category: "planning",
    defaultReasoning: false,
  },
  {
    key: "goal.map.refine",
    label: "Goal map refinement",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.mapRefinementInstructionContext,
    ),
  },
  {
    key: "goal.curriculum.replan",
    label: "Curriculum replan",
    category: "planning",
    defaultReasoning: true,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.curriculumPlanningInstructionContext,
    ),
  },
  {
    key: "goal.summary",
    label: "Goal summary",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.goalSummaryInstructionContext,
    ),
  },
  {
    key: "goal.overview",
    label: "Goal overview",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.overviewCourseInstructionContext,
    ),
  },
  {
    key: "goal.course_pattern",
    label: "Goal course pattern",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.goalCoursePatternInstructionContext,
    ),
  },
  {
    // Observability label used by the material workflow. It does not invoke a
    // model directly, but remains registered because the static boundary
    // checker validates operation labels in generation-owned source files.
    key: "persist-goal-course-pattern",
    label: "Persisted goal course-pattern extraction",
    category: "other",
    defaultReasoning: false,
  },
  {
    // Goal icons are authored from the caller-provided title only. Keep this
    // registered so structured-generation retries resolve to the same route.
    key: "goal.icon",
    label: "Goal icon",
    category: "other",
    defaultReasoning: false,
  },
  {
    key: "goal.micro_unit",
    label: "Micro-course unit",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.microUnitInstructionContext,
    ),
  },
  {
    key: "goal.micro_convert.title",
    label: "Micro-course conversion title",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.microTitleBroadenInstructionContext,
    ),
  },
  {
    key: "module.capabilities",
    label: "Module capabilities",
    category: "planning",
    defaultReasoning: true,
    contextProfile: moduleAuthoringInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.moduleCapabilitiesInstructionContext,
    ),
  },
  {
    key: "module.structure",
    label: "Module lesson structure",
    category: "planning",
    defaultReasoning: true,
    contextProfile: moduleAuthoringInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.moduleStructureInstructionContext,
    ),
  },
  {
    key: "module.exploration_structure",
    label: "Exploration module lesson structure",
    category: "planning",
    defaultReasoning: true,
    contextProfile: moduleAuthoringInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.moduleExplorationStructureInstructionContext,
    ),
  },
  {
    key: "goal.module_structure.audit",
    label: "Cross-module structure audit",
    category: "planning",
    defaultReasoning: true,
    contextProfile: moduleStructureAuditProfile(),
  },
  {
    key: "expand_map_branch",
    label: "Expand map branch",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.mapExpandBranchInstructionContext,
    ),
  },
  {
    key: "subdivide",
    label: "Subdivide learning unit",
    category: "planning",
    defaultReasoning: false,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.mapSubdivideInstructionContext,
    ),
  },

  {
    key: "unit.cognitive_model",
    label: "Unit cognitive model",
    category: "cognition",
    defaultReasoning: false,
    contextProfile: cognitionInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.cognitiveModelUnitInstructionContext,
    ),
  },
  {
    key: "cognitive_model.unit_generate.target_first.prefix",
    label: "Cognitive model · targets",
    category: "cognition",
    defaultReasoning: false,
    contextProfile: cognitionUnitGenerateInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.cognitiveModelTargetFirstInstructionContext,
    ),
  },
  {
    key: "cognitive_model.unit_generate.target_first.suffix",
    label: "Cognitive model · entities and relations",
    category: "cognition",
    defaultReasoning: false,
    contextProfile: cognitionUnitGenerateInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.cognitiveModelTargetFirstInstructionContext,
    ),
  },
  {
    key: "module.kacom.audit",
    label: "Module KACOM audit",
    category: "cognition",
    defaultReasoning: true,
    contextProfile: planningInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.moduleKacomAuditInstructionContext,
    ),
  },

  {
    key: "unit.authoring_agent",
    label: "Durable unit authoring agent",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitAuthoringAgentInstructionContext,
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.authoring_agent.cold_repair",
    label: "Unit authoring cold slot repair",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitAuthoringAgentInstructionContext,
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.sq_preview",
    label: "Survey preview",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitSqPreviewInstructionContext,
      // Target-first KACOM starts the learner-private Survey draft from the
      // validated frozen prefix before the canonical snapshot is published.
      // The operation input already carries that exact target contract, so a
      // persistence-backed objective view must not block early authoring.
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.section_plan",
    label: "Survey section plan",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitSectionPlanInstructionContext,
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.sq_question_answers",
    label: "Survey question answers",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitSqAnswersInstructionContext,
    ),
  },
  {
    key: "unit.learning_material",
    label: "Learning material",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitMaterialInstructionContext,
      // Material may continue from the same learner-private draft while the
      // KACOM suffix is still publishing. Its validated Survey input carries
      // the frozen targets; assessments still require canonical objectives.
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.formal_derivation.author",
    label: "Unit formal derivation author",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: profile({
      eagerViews: [
        eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, {
          required: true,
          allowStale: true,
        }),
        eagerView(
          LEARNING_SYSTEM_VIEW_KEYS.formalDerivationAuthoringInstruction,
          6_000,
          { required: true, allowStale: true },
        ),
      ],
      maxEagerContextTokens: 6_500,
      maxToolRounds: 80,
    }),
  },
  {
    key: "unit.teaching_derivation.enhance",
    label: "Teaching formula animation and highlighting enhancement",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: profile({
      eagerViews: [
        eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, {
          required: true,
          allowStale: true,
        }),
      ],
      maxEagerContextTokens: 500,
    }),
  },
  {
    key: "unit.teaching_derivation.author",
    label: "Unit teaching derivation author",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: profile({
      eagerViews: [
        eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, {
          required: true,
          allowStale: true,
        }),
        eagerView(
          LEARNING_SYSTEM_VIEW_KEYS.teachingDerivationAuthoringInstruction,
          5_000,
          { required: true, allowStale: true },
        ),
      ],
      maxEagerContextTokens: 5_500,
      maxToolRounds: 80,
    }),
  },




  {
    key: "goal_plan.content_repair",
    label: "Goal blueprint indexed content repair",
    category: "planning",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "survey.content_verify",
    label: "Survey content verification",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "survey.content_repair",
    label: "Survey indexed content repair",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "material.content_verify",
    label: "Material content verification",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "material.content_repair",
    label: "Material indexed content repair",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "mini_test.content_verify",
    label: "Section mini-test content verification",
    category: "assessment",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "mini_test.content_repair",
    label: "Section mini-test indexed content repair",
    category: "assessment",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "assessment.content_verify",
    label: "Assessment content verification",
    category: "assessment",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "assessment.content_repair",
    label: "Assessment indexed content repair",
    category: "assessment",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },
  {
    key: "unit.component_category_selection",
    label: "Component category selection",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.materialComponentSelectionInstructionContext,
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.learning_material.component_compile",
    label: "Complex component compiler",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.materialComponentCompileInstructionContext,
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.lab.manifest",
    label: "Lab declarative scene manifest",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.materialComponentCompileInstructionContext,
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.learning_material.svg_generate",
    label: "Static SVG diagram generator",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.materialSvgInstructionContext,
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.learning_material.svg_visual_audit",
    label: "Unit SVG visual audit",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    // The request already contains the complete check instruction and image.
    contextProfile: profile(),
  },
  {
    key: "unit.learning_material.guided_image.segment",
    label: "Guided image region segmentation",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: profile({ eagerViews: [eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, { required: true, allowStale: true }), eagerView(MATERIAL_COMPONENT_VIEW_KEYS.guidedImageSegmentInstructionContext, 3000, { required: true })] }),
  },
  {
    key: "unit.learning_material.guided_image.narrate",
    label: "Guided image grounded narration",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: profile({ eagerViews: [eagerView(BASE_CAPABILITY_VIEW_KEYS.generationPolicy, 500, { required: true, allowStale: true }), eagerView(MATERIAL_COMPONENT_VIEW_KEYS.guidedImageNarrateInstructionContext, 3000, { required: true })] }),
  },
  {
    key: "unit.learning_material.math_scene_audit",
    label: "Unit math scene semantic audit",
    category: "content",
    defaultReasoning: false,
    inheritBaseContext: false,
    // Fixed audit policy plus the teaching brief and declarative scene.
    contextProfile: profile(),
  },
  {
    key: "unit.learning_material.html_generate",
    label: "Interactive HTML diagram generator",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.materialHtmlInstructionContext,
      { requireLearningObjectives: false },
    ),
  },
  {
    key: "unit.learning_material.inline_check",
    label: "Material inline checks",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.materialInlineCheckInstructionContext,
    ),
  },
  {
    key: "unit.section_mini_test",
    label: "Section mini-test",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.materialInlineCheckInstructionContext,
    ),
  },
  {
    key: "unit.scenario_theater.prepare",
    label: "Scenario theater · cast preparation",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.scenarioTheaterPrepareInstructionContext,
    ),
  },
  {
    key: "unit.scenario_theater.scene",
    label: "Scenario theater · scene authoring",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.scenarioTheaterSceneInstructionContext,
    ),
  },
  {
    key: "unit.scenario_theater.finalize",
    label: "Scenario theater · final audit",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.scenarioTheaterFinalizeInstructionContext,
    ),
  },
  {
    key: "unit.cornell",
    label: "Cornell notes",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitCornellInstructionContext,
    ),
  },
  {
    key: "unit.key_points",
    label: "Course key points",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitKeyPointsInstructionContext,
    ),
  },
  {
    key: "unit.flashcards",
    label: "Flashcards",
    category: "content",
    defaultReasoning: false,
    contextProfile: contentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.unitFlashcardsInstructionContext,
    ),
  },


  {
    key: "unit.quiz",
    label: "Unit quiz",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: assessmentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.assessmentQuizInstructionContext,
    ),
  },
  {
    key: "unit.quiz_explain",
    label: "Quiz explanation",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: assessmentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.teachingQuizExplainInstructionContext,
    ),
  },
  {
    key: "unit.socratic",
    label: "Socratic correction",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: socraticDialogueProfile(),
  },
  {
    key: "unit.socratic.feedback",
    label: "Socratic feedback",
    category: "assessment",
    defaultReasoning: false,
    // Same eager stack as unit.socratic for common-prefix cache; invocation
    // carries the feedback-repair mode payload only.
    contextProfile: socraticDialogueProfile(),
  },
  {
    key: "unit.feynman",
    label: "Feynman activity",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: assessmentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.assessmentFeynmanInstructionContext,
    ),
  },
  {
    key: "unit.drills",
    label: "Practice drills",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: assessmentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.assessmentDrillsInstructionContext,
    ),
  },
  {
    key: "module.diagnostic",
    label: "Module diagnostic",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: assessmentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.assessmentDiagnosticInstructionContext,
    ),
  },
  {
    key: "unit.diagnostic",
    label: "Unit diagnostic",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: assessmentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.assessmentDiagnosticInstructionContext,
    ),
  },
  {
    key: "assessment.adaptive.evaluate",
    label: "Adaptive assessment evaluation",
    category: "assessment",
    defaultReasoning: false,
    contextProfile: assessmentInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.assessmentAdaptiveEvaluationInstructionContext,
    ),
  },

  {
    key: "agenda.refine",
    label: "Agenda refinement",
    category: "memory",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedMemoryInstructionProfile(
      LEARNING_SYSTEM_VIEW_KEYS.agendaRefineInstructionContext,
    ),
  },
  {
    // Evaluation-only rubric judges intentionally receive no learner/persona
    // context. The adapter lives under libs/server/src/evals and is never a
    // product publication path, but it still uses the normal route and
    // validated structured-output gateway.
    key: "eval.rubric_judge",
    label: "Evaluation rubric judge",
    category: "other",
    defaultReasoning: false,
    inheritBaseContext: false,
    contextProfile: isolatedVerificationProfile,
  },


];

function assertContextProfileIsSemanticallyScoped(
  operation: string,
  contextProfile: GenerationContextProfile,
): void {
  const keys = new Set(contextProfile.eagerViews.map((view) => view.key));
  const hasNarrowCurriculum =
    keys.has(LEARNING_SYSTEM_VIEW_KEYS.curriculumModule) ||
    keys.has(LEARNING_SYSTEM_VIEW_KEYS.curriculumUnit);
  if (
    hasNarrowCurriculum &&
    keys.has(LEARNING_SYSTEM_VIEW_KEYS.curriculumStructure)
  ) {
    throw new Error(
      `Operation "${operation}" mixes the complete curriculum snapshot with scoped module/unit projections`,
    );
  }
  let subjectContextSeen = false;
  for (const view of contextProfile.eagerViews) {
    if (
      view.semanticClass === "goal_projection" ||
      view.semanticClass === "module_projection" ||
      view.semanticClass === "unit_projection"
    ) {
      subjectContextSeen = true;
    }
    if (
      subjectContextSeen &&
      (view.semanticClass === "domain_teaching_guidance" ||
        view.semanticClass === "feature_policy")
    ) {
      throw new Error(
        `Operation "${operation}" places reusable guidance/policy after subject context`,
      );
    }
  }
}

export const compileLlmOperationDefinition = (
  {
    inheritBaseContext = true,
    includeLearnerNamePlaceholder = false,
    includeContentMarkup,
    ...definition
  }: LlmOperationDefinitionInput): LlmOperationDefinition => {
    const contextProfile =
      definition.contextProfile ?? defaultContextProfile(definition.category);
    const inheritedProfile = inheritBaseContext
      ? inheritBaseContextProfile(contextProfile)
      : contextProfile;
    const withMarkup =
      includeContentMarkup === true ||
      (includeContentMarkup !== false &&
        inheritBaseContext &&
        (definition.category === "content" ||
          definition.category === "assessment"))
        ? includeContentMarkupPolicy(inheritedProfile)
        : inheritedProfile;
    const withFeaturePolicy =
      inheritBaseContext && definition.category === "content"
        ? includeMaterialComponentPolicy(withMarkup)
        : withMarkup;
    const finalProfile = includeLearnerNamePlaceholder
      ? includeLearnerNamePlaceholderPolicy(withFeaturePolicy)
      : withFeaturePolicy;
    assertContextProfileIsSemanticallyScoped(definition.key, finalProfile);
    return {
      ...definition,
      contextProfile: finalProfile,
    };
  };

const definitions = rawDefinitions.map(compileLlmOperationDefinition);

export const LLM_OPERATION_CATALOG = Object.freeze(definitions);
const catalogByKey = new Map(definitions.map((entry) => [entry.key, entry]));
const hostRegistrations = new Map<string, readonly LlmOperationDefinition[]>();
/** Trusted hosts extend the operation catalog without adding their product policies to Core. */
export function registerHostLlmOperations(ownerId: string, inputs: readonly LlmOperationDefinitionInput[]): void {
  if (!ownerId.trim()) throw new Error("A host operation owner is required");
  const compiled = inputs.map(compileLlmOperationDefinition);
  const previous = hostRegistrations.get(ownerId);
  if (previous && JSON.stringify(previous) === JSON.stringify(compiled)) return;
  if (previous) throw new Error(`Host operation owner ${ownerId} is already registered`);
  const keys = new Set<string>();
  for (const entry of compiled) {
    if (keys.has(entry.key) || catalogByKey.has(entry.key)) throw new Error(`Duplicate LLM operation ${entry.key}`);
    keys.add(entry.key);
  }
  for (const entry of compiled) catalogByKey.set(entry.key, entry);
  hostRegistrations.set(ownerId, compiled);
}
export function listRegisteredLlmOperations(): readonly LlmOperationDefinition[] { return [...catalogByKey.values()]; }


export function getLlmOperationDefinition(
  operation: string,
): LlmOperationDefinition | undefined {
  return catalogByKey.get(canonicalLlmOperationKey(operation));
}

export function isRegisteredLlmOperation(operation: string): boolean {
  return Boolean(getLlmOperationDefinition(operation));
}

/** Retries and repair calls intentionally retain their parent logical route. */
export function canonicalLlmOperationKey(operation: string): string {
  let current = operation.trim();
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const suffix of [".retry", ".repair"]) {
      if (!current.endsWith(suffix)) continue;
      current = current.slice(0, -suffix.length);
      stripped = true;
      break;
    }
  }
  return current;
}
