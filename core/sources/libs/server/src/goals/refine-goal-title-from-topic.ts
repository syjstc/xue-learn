import { z } from "zod";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import {
  MICRO_COURSE_TITLE_PROMPT_RULE,
  sanitizeMicroCourseTitle,
} from "./sanitize-micro-course-title.js";
import { goalTitleNeedsRefinement } from "./refine-goal-title.js";
import {
  detectContentLanguage,
  getLanguagePromptInstruction,
  type ContentLanguageCode,
} from "../llm/content-language.js";

const topicSummarySchema = z.object({
  topic: z.string(),
  refinedTitle: z.string(),
  intentAnalysis: z.string(),
});

const TOPIC_SUMMARY_SCHEMA_SHAPE = `{
  "topic": "original user description",
  "refinedTitle": "short clear goal title (about 6-20 Chinese chars or 3-12 English words)",
  "intentAnalysis": "one-sentence intent analysis"
}`;

function buildRefineGoalTitleInput(
  topic: string,
  options?: {
    forMicroCourse?: boolean;
    contentLanguage?: ContentLanguageCode;
  },
): string {
  const microTitleRule = options?.forMicroCourse
    ? `\nAdditional micro-course title rule: ${MICRO_COURSE_TITLE_PROMPT_RULE}`
    : "";
  const contentLanguage =
    options?.contentLanguage ?? detectContentLanguage(topic);
  return `Learning goal: ${topic}
${getLanguagePromptInstruction(contentLanguage)}
Use that language for topic, refinedTitle, and intentAnalysis.${microTitleRule}`;
}

/** LLM-refine a learning goal topic into a short title plus intent analysis. */
export async function refineGoalTitleFromTopic(
  topic: string,
  options?: {
    forMicroCourse?: boolean;
    contentLanguage?: ContentLanguageCode;
    threadId?: string;
    userId?: string;
  },
): Promise<z.infer<typeof topicSummarySchema>> {
  const userId = options?.userId;
  const threadId = options?.threadId;
  const result = await runValidatedStructuredGeneration({
    mode: "object",
    schema: topicSummarySchema,
    prompt: buildRefineGoalTitleInput(topic, options),
    options: {
      operation: "agent.topic_summary",
      schemaShape: `${TOPIC_SUMMARY_SCHEMA_SHAPE}\nAll fields must be written in ${options?.contentLanguage ? "the requested content language" : "the input language"}.`,
      meta: options?.threadId ? { threadId: options.threadId } : undefined,
    },
    contextSubject:
      userId || threadId
        ? {
            ...(userId ? { userId } : {}),
            ...(threadId ? { threadId } : {}),
          }
        : undefined,
    contextQuery: topic.slice(0, 2_000),
  });
  if (!options?.forMicroCourse) return result;
  return {
    ...result,
    refinedTitle: sanitizeMicroCourseTitle(result.refinedTitle),
  };
}

/** Ensure a topic has a short refined title; calls the LLM when needed. */
export async function ensureGoalTitleFromTopic(
  topic: string,
  refinedTitle?: string | null,
  options?: {
    forMicroCourse?: boolean;
    contentLanguage?: ContentLanguageCode;
    threadId?: string;
    userId?: string;
  },
): Promise<{ topic: string; refinedTitle: string; intentAnalysis: string }> {
  const rawTopic = topic.trim();
  if (!rawTopic) {
    return { topic: "", refinedTitle: "", intentAnalysis: "" };
  }
  if (!goalTitleNeedsRefinement(rawTopic, refinedTitle)) {
    return {
      topic: rawTopic,
      refinedTitle: (refinedTitle ?? rawTopic).trim(),
      intentAnalysis: "",
    };
  }
  const summary = await refineGoalTitleFromTopic(rawTopic, options);
  return {
    topic: rawTopic,
    refinedTitle: summary.refinedTitle.trim() || rawTopic,
    intentAnalysis: summary.intentAnalysis.trim(),
  };
}
