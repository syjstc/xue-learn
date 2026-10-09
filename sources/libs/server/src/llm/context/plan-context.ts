import { GOAL_DIRECTED_TEACHING_POLICY } from "../../goal-creation/teaching-policy.js";
import { isImageGenerationAvailable } from "../../images/providers/index.js";
import type { TopicCategory } from "../../../../common/src/index.js";
import {
  getImageLabelLanguageInstruction,
  getLanguagePromptInstruction,
  resolveGoalContentLanguage,
  type ContentLanguageCode,
} from "../content-language.js";
import { getContentMarkupPromptBlock } from "../content-markup.js";
import { getGenerationOptionsPromptBlock } from "../generation-options.js";
import {
  formatLearnerProfilePromptBlock,
  getLearnerProfile,
} from "../../persona/learner-profile.js";
import { formatGlobalLearnerStateMemoryPrompt } from "../../learner-state-memory/index.js";
import { formatCognitiveStatePromptBlock } from "../../cognition/context.js";
import { resolveGoalTopicCategory } from "../../goals/resolve-goal-topic-category.js";
import {
  formatTeachingPersonaPromptBlock,
  resolveTeachingPersona,
  getBuiltinTeachingPersona,
  DEFAULT_TEACHING_PERSONA_REF,
  resolvePersonaPromptLocale,
} from "../../teaching-personas/index.js";

export type PlanContextGoal = {
  id: string;
  title: string;
  level?: string | null;
  contentLanguage: string | null | undefined;
  generationOptions?: string | null;
  topicCategory?: TopicCategory | string | null;
  mapPlanJson?: string | null;
  userId?: string | null;
};

export interface PlanContext {
  readonly goalId: string;
  readonly userId?: string;
  readonly goalTitle: string;
  readonly level: string;
  readonly langCode: ContentLanguageCode;
  readonly styleCode: "teaching-persona";
  readonly learnerProfileBlock: string;
  readonly topicCategory: TopicCategory;
  readonly teachingPersonaRef?: string;
  readonly teachingPersonaArchetype?: string;
  goalBlock(): string;
  difficultyBlock(): string;
  timeBudgetBlock(): string;
  languageBlock(): string;
  imageLabelBlock(): string;
  styleBlock(): string;
  optionsBlock(): string;
  contentMarkupBlock(): string;
  profileBlock(): string;
}

class PlanContextImpl implements PlanContext {
  readonly styleCode = "teaching-persona" as const;

  get userId(): string | undefined {
    return this.goal.userId ?? undefined;
  }

  constructor(
    public readonly goalId: string,
    private readonly goal: PlanContextGoal,
    public readonly goalTitle: string,
    public readonly level: string,
    public readonly langCode: ContentLanguageCode,
    private readonly teachingPersonaBlock: string,
    public readonly learnerProfileBlock: string,
    public readonly topicCategory: TopicCategory,
    public readonly teachingPersonaRef?: string,
    public readonly teachingPersonaArchetype?: string,
  ) {}

  goalBlock(): string {
    return `Overall learning goal: ${this.goalTitle}
Learner starting level (not the target level): ${this.level}.${this.learnerProfileBlock ? `\n${this.learnerProfileBlock}` : ""}`;
  }

  difficultyBlock(): string {
    const label =
      this.level === "zero"
        ? "zero beginner"
        : this.level === "basic"
          ? "has some foundation"
          : this.level === "advanced"
            ? "advanced learner"
            : this.level;
    return `Difficulty calibration: learner level is ${label}. Scaffold explanations and bridge missing foundations from this starting point while progressing to the confirmed target level. Never cap exit abilities or final practice at the entry level.`;
  }

  timeBudgetBlock(): string {
    return "";
  }

  languageBlock(): string {
    return getLanguagePromptInstruction(this.langCode);
  }

  imageLabelBlock(): string {
    if (!isImageGenerationAvailable()) return "";
    return getImageLabelLanguageInstruction(this.langCode);
  }

  styleBlock(): string {
    return this.teachingPersonaBlock;
  }

  optionsBlock(): string {
    return `${GOAL_DIRECTED_TEACHING_POLICY}\n\n${getGenerationOptionsPromptBlock(this.goal.generationOptions)}`;
  }

  contentMarkupBlock(): string {
    return getContentMarkupPromptBlock({
      topicCategory: this.topicCategory,
      goalTitle: this.goalTitle,
    });
  }

  profileBlock(): string {
    return this.learnerProfileBlock;
  }
}

export function buildPlanContext(
  goal: PlanContextGoal,
  options: {
    learnerProfileBlock?: string;
    teachingPersonaBlock?: string;
    teachingPersonaRef?: string;
    teachingPersonaArchetype?: string;
  } = {},
): PlanContext {
  const langCode = resolveGoalContentLanguage(goal.contentLanguage, goal.title);
  const topicCategory = resolveGoalTopicCategory(goal);
  const defaultPersona = getBuiltinTeachingPersona(
    DEFAULT_TEACHING_PERSONA_REF,
  )!;
  return new PlanContextImpl(
    goal.id,
    goal,
    goal.title,
    goal.level ?? "zero",
    langCode,
    options.teachingPersonaBlock ??
      formatTeachingPersonaPromptBlock(
        getBuiltinTeachingPersona(
          DEFAULT_TEACHING_PERSONA_REF,
          resolvePersonaPromptLocale(langCode),
        ) ?? defaultPersona,
      ),
    options.learnerProfileBlock ?? "",
    topicCategory,
    options.teachingPersonaRef,
    options.teachingPersonaArchetype,
  );
}

export async function buildPlanContextWithLearnerProfile(
  goal: PlanContextGoal,
): Promise<PlanContext> {
  if (!goal.userId) return buildPlanContext(goal);
  const [profile, memoryBlock, knowledgeBlock, teachingPersona] =
    await Promise.all([
      getLearnerProfile(goal.userId),
      formatGlobalLearnerStateMemoryPrompt(goal.userId),
      formatCognitiveStatePromptBlock(goal.userId, goal.id),
      resolveTeachingPersona(
        goal.userId,
        goal.id,
        resolvePersonaPromptLocale(
          resolveGoalContentLanguage(goal.contentLanguage, goal.title),
        ),
      ),
    ]);
  const profileBlock = formatLearnerProfilePromptBlock(profile);
  const learnerProfileBlock = [profileBlock, memoryBlock, knowledgeBlock]
    .filter(Boolean)
    .join("\n\n");
  return buildPlanContext(goal, {
    learnerProfileBlock,
    teachingPersonaBlock: formatTeachingPersonaPromptBlock(teachingPersona),
    teachingPersonaRef: teachingPersona.ref,
    teachingPersonaArchetype: teachingPersona.archetypeCode ?? undefined,
  });
}
