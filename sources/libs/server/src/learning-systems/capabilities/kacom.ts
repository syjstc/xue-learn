import type { LearningSystemPersistenceClient } from "../persistence-client.js";
import { match, P } from "ts-pattern";
import { z } from "zod";
import {
  extractLearnerProfile,
  formatLearnerProfilePromptBlock,
} from "../../persona/learner-profile.js";
import type { TeachingSkillStage } from "../../teaching-skills/index.js";
import type {
  CapabilityQueryTool,
  CapabilitySettingsPort,
  LearningSystemCapability,
} from "../types.js";
import * as shared from "./support/builtin.js";
import type { BuiltinReadCapabilityDependencies } from "./support/builtin.js";
import { COGNITIVE_MODEL_VIEW_KEYS } from "./kacom-generation-keys.js";
const KACOM_GENERATION_INSTRUCTIONS = Object.freeze({
  [COGNITIVE_MODEL_VIEW_KEYS.unitInstructionContext]:
    "Generate one server-validated KACOM unit model. Preserve the declared objective and evidence contracts; emit only the requested structured output.",
  [COGNITIVE_MODEL_VIEW_KEYS.targetFirstInstructionContext]:
    "Generate one server-validated two-phase target-first KACOM unit model. Preserve the declared objective, frozen identity, and evidence contracts; emit only the structured output requested by the current phase.",
  [COGNITIVE_MODEL_VIEW_KEYS.targetPrefixInstructionContext]:
    "Generate phase 1 of the target-first KACOM model: stable entity identities and complete immutable LearningTarget contracts only.",
  [COGNITIVE_MODEL_VIEW_KEYS.targetSuffixInstructionContext]:
    "Generate phase 2 of the target-first KACOM model against the frozen prefix: entity details, relations, components, and audit only.",
});

const {
  VERSION,
  SCHEMA_VERSION,
  BUILTIN_READ_VIEW_KEYS,
  BUILTIN_READ_QUERY_TOOL_KEYS,
  preferencesResultSchema,
  goalSearchResultSchema,
  unitSearchResultSchema,
  cognitiveStateResultSchema,
  objectivesResultSchema,
  iso,
  abortIfNeeded,
  envelope,
  parseJsonObject,
  compactText,
  loadGoal,
  loadCurriculum,
  loadCurrentUnit,
  compactSession,
  compactMaterial,
  compactLearningTarget,
  authorizeCognitiveSubject,
  loadObjectives,
  loadCognitiveState,
} = shared;

export function createKacomCapability(
  persistence: LearningSystemPersistenceClient,
  deps: BuiltinReadCapabilityDependencies,
): LearningSystemCapability {
  const capabilityId = "kacom";

  const stateTool: CapabilityQueryTool<
    Record<string, never>,
    z.infer<typeof cognitiveStateResultSchema>
  > = {
    key: BUILTIN_READ_QUERY_TOOL_KEYS.getCurrentLearningState,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description:
      "Read the current learner's verified KACOM-derived state for the server-bound goal or unit.",
    inputSchema: z.object({}).strict(),
    resultSchema: cognitiveStateResultSchema,
    requiredScopes: ["user"],
    authority: "verified_learner_state",
    maxResultTokens: 2_500,
    query: async (subject, _input, signal) => {
      abortIfNeeded(signal);
      const state = await loadCognitiveState(persistence, deps, subject);
      if (!state) {
        throw new Error("The requested learning-state scope is unavailable");
      }
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "verified_learner_state",
        scope: { ...subject },
        data: state,
      });
    },
  };

  const objectivesTool: CapabilityQueryTool<
    Record<string, never>,
    z.infer<typeof objectivesResultSchema>
  > = {
    key: BUILTIN_READ_QUERY_TOOL_KEYS.getLearningObjectives,
    ownerCapabilityId: capabilityId,
    schemaVersion: SCHEMA_VERSION,
    description:
      "Read immutable learning objectives for the server-bound mastery goal or unit.",
    inputSchema: z.object({}).strict(),
    resultSchema: objectivesResultSchema,
    requiredScopes: ["user"],
    authority: "objective_definition",
    maxResultTokens: 2_500,
    query: async (subject, _input, signal) => {
      abortIfNeeded(signal);
      const result = await loadObjectives(persistence, deps, subject);
      if (!result) {
        throw new Error("The requested objective scope is unavailable");
      }
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "objective_definition",
        scope: { ...subject },
        data: result,
      });
    },
  };

  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "learning_system",
      providesViews: [
        BUILTIN_READ_VIEW_KEYS.learnerCognitiveState,
        BUILTIN_READ_VIEW_KEYS.learningObjectives,
        BUILTIN_READ_VIEW_KEYS.learningAssessmentAuthority,
        COGNITIVE_MODEL_VIEW_KEYS.unitInstructionContext,
        COGNITIVE_MODEL_VIEW_KEYS.targetFirstInstructionContext,
        COGNITIVE_MODEL_VIEW_KEYS.targetPrefixInstructionContext,
        COGNITIVE_MODEL_VIEW_KEYS.targetSuffixInstructionContext,
      ],
      providesQueryTools: [stateTool.key, objectivesTool.key],
    },
    getView: async (request) => {
      const generationInstruction =
        KACOM_GENERATION_INSTRUCTIONS[
          request.key as keyof typeof KACOM_GENERATION_INSTRUCTIONS
        ];
      if (generationInstruction) {
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "server_policy",
          scope: { ...request.subject },
          data: { promptBlock: generationInstruction },
        });
      }
      if (!request.subject.userId) return null;
      if (request.key === BUILTIN_READ_VIEW_KEYS.learnerCognitiveState) {
        const state = await loadCognitiveState(persistence, deps, request.subject);
        return state
          ? envelope({
              ownerCapabilityId: capabilityId,
              authority: "verified_learner_state",
              scope: { ...request.subject },
              data: state,
            })
          : null;
      }
      if (request.key === BUILTIN_READ_VIEW_KEYS.learningAssessmentAuthority) {
        const authorized = await authorizeCognitiveSubject(
          persistence,
          request.subject,
        );
        if (!authorized) return null;
        const requiresKacom =
          authorized.goalKind !== null &&
          authorized.goalKind !== "micro" &&
          authorized.learningMode !== "exploration";
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "server_policy",
          scope: { ...request.subject },
          data: {
            mode: requiresKacom
              ? "kacom_authoritative"
              : "standalone_self_check",
            requiresKacom,
            status: requiresKacom
              ? (authorized.unitCognitiveModelStatus ??
                authorized.goalCognitiveModelStatus ??
                "unknown")
              : "not_applicable",
          },
        });
      }
      if (request.key === BUILTIN_READ_VIEW_KEYS.learningObjectives) {
        const objectives = await loadObjectives(persistence, deps, request.subject);
        if (!objectives) return null;
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "objective_definition",
          scope: { ...request.subject },
          data: objectives,
        });
      }
      return null;
    },
    getQueryTools: () =>
      [stateTool, objectivesTool] as unknown as CapabilityQueryTool[],
  };
}
