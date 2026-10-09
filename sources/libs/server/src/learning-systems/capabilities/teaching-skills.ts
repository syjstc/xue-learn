import type { LearningGoalRepository } from "../../../../domain/src/index.js";
import { match, P } from "ts-pattern";
import type { TeachingSkillStage } from "../../teaching-skills/index.js";
import { TEACHING_SKILL_VIEW_KEYS } from "../../teaching-skills/keys.js";
import type { LearningSystemCapability } from "../types.js";
import {
  BUILTIN_READ_VIEW_KEYS,
  VERSION,
  envelope,
  type BuiltinReadCapabilityDependencies,
} from "./support/builtin.js";

let configuredGoals: LearningGoalRepository | undefined;

export function configureTeachingSkillsCapabilityPersistence(
  goals: LearningGoalRepository | undefined,
): void {
  configuredGoals = goals;
}

function goals(): LearningGoalRepository {
  if (!configuredGoals) {
    throw new Error("Teaching-skills capability persistence is not configured");
  }
  return configuredGoals;
}

function teachingSkillStageForOperation(
  operation?: string,
): TeachingSkillStage {
  return match(operation)
    .with(P.nullish, () => "goal_plan" as const)
    .when(
      (value) => value.startsWith("unit.scenario_theater."),
      () => "scenario_theater" as const,
    )
    .when(
      (value) =>
        value.startsWith("module.") ||
        value.includes("cognitive_model") ||
        value.includes("kacom"),
      () => "module_units" as const,
    )
    .when(
      (value) => value.startsWith("goal."),
      () => "goal_plan" as const,
    )
    .otherwise(() => "unit_content" as const);
}

export function createTeachingSkillsCapability(
  deps: BuiltinReadCapabilityDependencies,
): LearningSystemCapability {
  const capabilityId = "teaching-skills";
  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "learning_system",
      providesViews: [
        BUILTIN_READ_VIEW_KEYS.teachingDomainGuidance,
        TEACHING_SKILL_VIEW_KEYS.selectionInstruction,
      ],
    },
    getView: async (request) => {
      if (request.key === TEACHING_SKILL_VIEW_KEYS.selectionInstruction) {
        const invocation = request.invocation as
          { goalContext?: string; candidates?: string } | undefined;
        if (!invocation?.goalContext || !invocation.candidates) return null;
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "server_policy",
          scope: { ...request.subject },
          data: {
            promptBlock: `Select up to three complementary specialist domain-teaching skills for the learning goal and candidate list supplied in the invocation input, ordered from primary to secondary.
Choose multiple skills only when the learner's goal genuinely spans distinct domains that need different teaching methods. Avoid redundant or weakly related helpers. Do not select language-learning for linguistics or literature, or coding-by-building for purely theoretical computer science. Return an empty list when no specialist is a confident match.

Goal context:
${invocation.goalContext}

Candidates:
${invocation.candidates}`,
          },
        });
      }
      if (
        request.key !== BUILTIN_READ_VIEW_KEYS.teachingDomainGuidance ||
        !request.subject.userId ||
        !request.subject.goalId
      ) {
        return null;
      }
      const ownedGoal = await goals().findOwnedById(
        request.subject.userId,
        request.subject.goalId,
      );
      if (!ownedGoal) return null;
      const skill = await deps.loadTeachingSkillPrompt(
        ownedGoal.id,
        teachingSkillStageForOperation(request.operation),
        request.query ?? "",
      );
      if (!skill) return null;
      const reusablePromptBlock = skill.promptBlock.replace(
        /\[Domain teaching skill: ([^;\]]+); slug=[^;\]]+; version=\d+; hash=[a-f0-9]{64}\]/g,
        "[Domain teaching skill: $1]",
      );
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "pedagogical_guidance",
        scope: {
          userId: request.subject.userId,
          goalId: ownedGoal.id,
        },
        data: {
          skillId: skill.skillId,
          slug: skill.slug,
          version: skill.version,
          contentHash: skill.contentHash,
          promptBlock: reusablePromptBlock,
        },
      });
    },
  };
}
