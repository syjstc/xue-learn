import { createHostLearningCapabilities } from "../host-capabilities.js";
import { formatCognitiveStatePromptBlock } from "../../cognition/context.js";
import {
  getGoalCognitiveModel,
  getUnitLearningTargetsV2,
} from "../../cognitive-model/presentation.js";
import { formatGlobalLearnerStateMemoryPrompt } from "../../learner-state-memory/index.js";
import {
  formatTeachingPersonaPromptBlockForUser,
  formatTeachingPersonaPromptPartForUser,
} from "../../teaching-personas/index.js";
import { loadTeachingSkillPrompt } from "../../teaching-skills/index.js";
import { upsertUserSettingsForUser } from "../../user-settings.js";
import { createCurriculumSessionCapability } from "../capabilities/curriculum-session.js";
import { createGeneralMemoryCapability } from "../capabilities/general-memory.js";
import { createKacomCapability } from "../capabilities/kacom.js";
import { createLearnerProfileCapability } from "../capabilities/learner-profile.js";
import { createLearningExperienceCapability } from "../capabilities/learning-experience.js";
import { createTeachingPersonaCapability } from "../capabilities/teaching-persona.js";
import { createTeachingSkillsCapability } from "../capabilities/teaching-skills.js";
import type { LearningSystemCapability } from "../types.js";
import type {
  BuiltinReadCapabilityDependencies,
  CreateBuiltinReadCapabilitiesOptions,
} from "../capabilities/support/builtin.js";
import { createAssistantPolicyCapability } from "../capabilities/assistant-policy/capability.js";
import { createAgentCoreCapability } from "../../agents/core/capability.js";
import { createGoalCreationCapability } from "../../agents/goal-creation/capability.js";
import { createGoalTitleRefinementCapability } from "../../goals/title-refinement-capability.js";
import { createMaterialFollowUpCapability } from "../../agents/material-follow-up/capability.js";
import { createCurriculumPlanningCapability } from "../../llm/plan-goal-map.js";
import { createMapRefinementCapability } from "../../llm/refine-map.js";
import { createGoalSummaryCapability } from "../../llm/plan-goal-summary.js";
import { createGoalCoursePatternCapability } from "../../llm/goal-course-pattern.js";
import { createMicroUnitCapability } from "../../llm/micro-unit.js";
import { createMicroTitleCapability } from "../../goals/broaden-micro-goal-title.js";
import { createOverviewCourseCapability } from "../../goals/generate-overview-course.js";
import { createModuleCurriculumCapability } from "../../llm/module-curriculum.js";
import { createGoalMapCapability } from "../../llm/decompose.js";
import { createMapExpansionCapability } from "../../llm/map-expansion-capability.js";
import { createUnitContentCapability } from "../capabilities/unit-content/capability.js";
import { createMaterialComponentsCapability } from "../capabilities/material-components/capability.js";
import { createTeachingDialogueCapability } from "../capabilities/teaching-dialogue/capability.js";
import { createMathVisualizationCapability } from "../capabilities/math-visualization/capability.js";
import { createSvgVisualizationCapability } from "../capabilities/svg-visualization/capability.js";
import { createFormalDerivationCapability } from "../capabilities/formal-derivation/capability.js";
import { createTeachingDerivationCapability } from "../capabilities/teaching-derivation/capability.js";
import { createLearningSpacesCapability } from "../capabilities/learning-spaces.js";

export * from "./base.js";
export {
  BUILTIN_READ_QUERY_TOOL_KEYS,
  BUILTIN_READ_VIEW_KEYS,
} from "../capabilities/support/builtin.js";
export type { CreateBuiltinReadCapabilitiesOptions } from "../capabilities/support/builtin.js";

export function createBuiltinReadCapabilities(
  options: CreateBuiltinReadCapabilitiesOptions = {},
): LearningSystemCapability[] {
  const persistence = options.persistence;
  if (!persistence) throw new Error("Learning-system persistence is not configured");
  const dependencies: BuiltinReadCapabilityDependencies = {
    formatGlobalLearnerStateMemoryPrompt: (userId, client) =>
      formatGlobalLearnerStateMemoryPrompt(
        userId,
        client,
        options.learnerStateMemoryRead,
      ),
    formatCognitiveStatePromptBlock: (userId, goalId) =>
      formatCognitiveStatePromptBlock(
        userId,
        goalId,
        options.learnerStateProjectionRead,
      ),
    formatTeachingPersonaPromptPartForUser,
    formatTeachingPersonaPromptBlockForUser,
    getGoalCognitiveModel: (_client, goalId, requestOptions) =>
      getGoalCognitiveModel(undefined, goalId, {
        ...requestOptions,
        presentationRead: options.cognitiveModelPresentationRead,
        stateRead: options.learnerStateProjectionRead,
      }),
    getUnitLearningTargetsV2: (_client, unitId, requestOptions) =>
      getUnitLearningTargetsV2(undefined, unitId, {
        ...requestOptions,
        presentationRead: options.cognitiveModelPresentationRead,
        stateRead: options.learnerStateProjectionRead,
      }),
    upsertUserSettingsForUser,
    loadTeachingSkillPrompt,
    ...options.dependencies,
  };
  return [
    createAgentCoreCapability(),
    createAssistantPolicyCapability(),
    createGoalCreationCapability({
      learningSpaceApplication: options.learningSpaceApplication,
    }),
    createGoalTitleRefinementCapability(),
    createMaterialFollowUpCapability(),
    createCurriculumPlanningCapability(),
    createMapRefinementCapability(),
    createGoalSummaryCapability(),
    createGoalCoursePatternCapability(),
    createMicroUnitCapability(),
    createMicroTitleCapability(),
    createOverviewCourseCapability(),
    createModuleCurriculumCapability(),
    createGoalMapCapability(),
    createMapExpansionCapability(),
    createUnitContentCapability(),
    createMaterialComponentsCapability(),
    createTeachingDialogueCapability(),
    createMathVisualizationCapability(),
    createSvgVisualizationCapability(),
    createFormalDerivationCapability(),
    createTeachingDerivationCapability(),
    createLearningSpacesCapability(
      options.learningSpacePortfolio
        ? { getPortfolio: options.learningSpacePortfolio }
        : undefined,
    ),
    createGeneralMemoryCapability(),
    createLearnerProfileCapability(),
    createLearningExperienceCapability(dependencies),
    createCurriculumSessionCapability(persistence),
    createKacomCapability(persistence, dependencies),
    createTeachingPersonaCapability(dependencies),
    createTeachingSkillsCapability(dependencies),
    ...createHostLearningCapabilities(options),
  ];
}

export * from "./runtime-context.js";
export * from "./optional-context.js";
export * from "./write-commands.js";
