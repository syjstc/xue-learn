import { z } from "zod";
import { FEATURE_COURSE_PATTERN } from "../../features.js";
import {
  appendGoalCoursePattern,
  hasGoalCoursePattern,
  resolveGoalGenerationOptions,
  stripGoalCoursePattern,
} from "../../llm/generation-options.js";
import {
  getLanguagePromptInstruction,
  type ContentLanguageCode,
} from "../../llm/content-language.js";
import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { fallbackGoalCoursePattern } from "../../llm/goal-course-pattern-fallback.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { GOAL_COURSE_PATTERN_VIEW_KEYS } from "../../llm/goal-course-pattern-keys.js";

const goalCoursePatternSchema = z.object({
  patternTitle: z.string().min(1),
  recurringStructure: z.array(z.string().min(1)).min(3).max(8),
  blockUsage: z.array(z.string().min(1)).min(2).max(8),
  structuralRules: z.array(z.string().min(1)).min(2).max(8),
  contextReuseRules: z.array(z.string().min(1)).min(2).max(8),
});

type GoalCoursePattern = z.infer<typeof goalCoursePatternSchema>;

const GOAL_COURSE_PATTERN_SHAPE = `{
  "patternTitle": "short name for this goal's recurring lesson pattern",
  "recurringStructure": ["3-8 ordered lesson sections similar units should reuse"],
  "blockUsage": ["2-8 UI/content block habits: e.g. headings, examples, checks, compare panels"],
  "structuralRules": ["2-8 non-style rules for ordering, repeated sections, examples, and practice"],
  "contextReuseRules": ["2-8 rules for shared vs per-unit context: introduce common background once; later units only reference briefly"]
}`;

const GOAL_COURSE_PATTERN_INSTRUCTION = `Create the requested reusable XueLearn course pattern from the invocation input.
- Define reusable lesson structure and context-reuse rules only; do not create course content or a syllabus.
- Preserve the supplied goal, learner level, language, and preferences.
- Follow the invocation's complete pattern rules and structured-output contract.`;

function formatPattern(pattern: GoalCoursePattern): string {
  return [
    `Pattern title: ${pattern.patternTitle}`,
    "Recurring structure:",
    ...pattern.recurringStructure.map((item, index) => `${index + 1}. ${item}`),
    "Block usage:",
    ...pattern.blockUsage.map((item) => `- ${item}`),
    "Structural rules:",
    ...pattern.structuralRules.map((item) => `- ${item}`),
    "Context reuse rules:",
    ...pattern.contextReuseRules.map((item) => `- ${item}`),
  ].join("\n");
}

function buildGoalCoursePatternPrompt(params: {
  title: string;
  level: string;
  contentLanguage: ContentLanguageCode;
  generationOptions?: string | null;
}) {
  const languageBlock = getLanguagePromptInstruction(params.contentLanguage);
  const baseOptions = stripGoalCoursePattern(params.generationOptions);
  return `Create a SIMPLE reusable course block pattern for one learning goal.
This pattern will be stored as global context for the goal and reused when generating every unit, so similar units feel consistent.
It should describe ONLY recurring outline, content block usage, practice shape, and how shared vs per-unit context should be reused.
Identify recurring entities or themes across similar units (author, historical period, dynasty, grammar family, shared technique, etc.).
In contextReuseRules, require that common background is introduced once in the first relevant lesson or a separate overview module; later units only reference it briefly when needed and focus on item-specific work.
Do NOT describe tone, voice, writing style, formality, personality, or visual theme. The user can change style separately.
Do not create actual course content or a full syllabus.

Goal: ${params.title}
Learner level: ${params.level}
${baseOptions ? `Existing user preferences:\n${baseOptions}\n` : ""}
${languageBlock}

Required JSON shape:
${GOAL_COURSE_PATTERN_SHAPE}

Respond with ONLY a single JSON object. No markdown fences or thinking tags.`;
}

export function createGoalCoursePatternCapability() {
  const capabilityId = "goal-course-pattern";
  const version = "1.1.0";
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [GOAL_COURSE_PATTERN_VIEW_KEYS.instructionContext]: async ({
        subject,
      }): Promise<ContextEnvelope | null> => {
        return {
          ownerCapabilityId: capabilityId,
          ownerCapabilityVersion: version,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: { promptBlock: GOAL_COURSE_PATTERN_INSTRUCTION },
        };
      },
    },
  });
}

export async function generateGoalCoursePattern(params: {
  title: string;
  level: string;
  contentLanguage: ContentLanguageCode;
  generationOptions?: string | null;
}): Promise<string> {
  if (!FEATURE_COURSE_PATTERN) return "";
  try {
    const pattern = await runValidatedStructuredGeneration({
      mode: "object",
      schema: goalCoursePatternSchema,
      prompt: buildGoalCoursePatternPrompt(params),
      options: {
        operation: "goal.course_pattern",
        meta: {
          goalTitle: params.title,
          level: params.level,
          contentLanguage: params.contentLanguage,
        },
        schemaShape: GOAL_COURSE_PATTERN_SHAPE,
      },
      contextSubject: {},
      contextQuery: params.title.slice(0, 2_000),
      contextInvocation: params,
    });
    return formatPattern(pattern);
  } catch (error) {
    console.error("Failed to generate goal course pattern", error);
    return fallbackGoalCoursePattern(params);
  }
}

export async function resolveGoalGenerationOptionsWithPattern(params: {
  title: string;
  level: string;
  contentLanguage: ContentLanguageCode;
  generationOptions?: string | null;
  isSmallCourse?: boolean;
}): Promise<string> {
  const base = resolveGoalGenerationOptions(
    params.generationOptions,
    params.isSmallCourse,
  );
  if (!FEATURE_COURSE_PATTERN) return base;
  if (hasGoalCoursePattern(base)) return base;
  const pattern = await generateGoalCoursePattern({
    title: params.title,
    level: params.level,
    contentLanguage: params.contentLanguage,
    generationOptions: base,
  });
  return appendGoalCoursePattern(base, pattern);
}
