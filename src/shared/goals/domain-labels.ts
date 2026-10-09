import type { LearningMode } from "@xue-learn/core/source/src/shared/llm/schemas.ts";

export const LEARNING_MODE_LABELS: Record<LearningMode, string> = {
  skill_practice: "技能实践（学会做/用）",
  conceptual_understanding: "概念理解（理解原理与体系）",
  research_scholarship: "学科研究（学术性探究）",
  professional_applied: "职业应用（岗位与实务）",
  creative_expression: "创作表达（产出与风格）",
  mixed: "混合模式",
};

export const DOMAIN_TAG_LABELS: Record<
  "stem" | "humanities" | "general",
  string
> = {
  stem: "理工 / STEM",
  humanities: "人文 / 语言艺术",
  general: "综合",
};
