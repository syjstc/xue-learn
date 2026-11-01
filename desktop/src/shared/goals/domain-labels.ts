import type { LearningMode } from "@xue-learn/core/schemas";
import { translateCurrent } from "@xue-learn/core/i18n";

export const LEARNING_MODE_LABELS: Record<LearningMode, string> = {
  get skill_practice() {
    return translateCurrent("desktop.learningMode.skillPractice");
  },
  get conceptual_understanding() {
    return translateCurrent("desktop.learningMode.conceptualUnderstanding");
  },
  get research_scholarship() {
    return translateCurrent("desktop.learningMode.researchScholarship");
  },
  get professional_applied() {
    return translateCurrent("desktop.learningMode.professionalApplied");
  },
  get creative_expression() {
    return translateCurrent("desktop.learningMode.creativeExpression");
  },
  get mixed() {
    return translateCurrent("desktop.learningMode.mixed");
  },
};

export const DOMAIN_TAG_LABELS: Record<
  "stem" | "humanities" | "general",
  string
> = {
  get stem() {
    return translateCurrent("desktop.domainTag.stem");
  },
  get humanities() {
    return translateCurrent("desktop.domainTag.humanities");
  },
  get general() {
    return translateCurrent("desktop.domainTag.general");
  },
};
