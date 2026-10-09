import { z } from "zod";
import { TOPIC_CATEGORIES } from "../../../common/src/index.js";

export const teachingSkillStageSchema = z.enum([
  "goal_plan",
  "module_units",
  "unit_content",
  "scenario_theater",
]);
export type TeachingSkillStage = z.infer<typeof teachingSkillStageSchema>;

const learningModeSchema = z.enum([
  "skill_practice",
  "conceptual_understanding",
  "research_scholarship",
  "professional_applied",
  "creative_expression",
  "mixed",
]);

export const teachingSkillAdapterSchema = z
  .object({
    schema: z.literal("xuelearn.domain-teaching-skill/v1"),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    topicCategory: z.enum(TOPIC_CATEGORIES),
    domainPaths: z.array(z.string().trim().min(1).max(120)).max(20),
    tags: z.array(z.string().trim().min(1).max(60)).max(30),
    learningModes: z.array(learningModeSchema).max(6),
    appliesTo: z.array(teachingSkillStageSchema).min(1),
    references: z
      .array(
        z
          .object({
            path: z.string().regex(/^references\/[A-Za-z0-9._-]+$/),
            appliesTo: z.array(teachingSkillStageSchema).min(1),
            keywords: z.array(z.string().trim().min(1).max(60)).max(30),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type TeachingSkillAdapter = z.infer<typeof teachingSkillAdapterSchema>;

export type TeachingSkillPackage = {
  skillMd: string;
  adapter: TeachingSkillAdapter;
  files: Array<{
    path: string;
    content: string;
    appliesTo: TeachingSkillStage[];
    keywords: string[];
  }>;
  name: string;
  description: string;
  contentHash: string;
};

export type ResolvedTeachingSkill = {
  skillId: string;
  slug: string;
  version: number;
  name: string;
  contentHash: string;
  promptBlock: string;
};
