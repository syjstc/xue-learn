import {
  type ContentLanguageCode,
  getContentLanguageLabel,
  getLanguagePromptInstruction,
} from "../../llm/content-language.js";
import { getGenerationOptionsPromptBlock } from "../../llm/generation-options.js";
import {
  MICRO_COURSE_TITLE_PROMPT_RULE,
  sanitizeMicroCourseTitle,
} from "../../goals/sanitize-micro-course-title.js";
import type { StreamTokenHandler } from "../../llm/chat-stream.js";
import { microUnitResultSchema, type MicroUnitResult } from "../../llm/schemas.js";
import type { MicroUnitDslPreview } from "../../llm/map-dsl.js";
import {
  assembleMicroUnitItems,
  microUnitJitItemSchema,
  microUnitJitItemsSchema,
  type MicroUnitJitItem,
} from "../../llm/jit-structured-items.js";
import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { MICRO_UNIT_VIEW_KEYS } from "../../llm/micro-unit-keys.js";

const MICRO_UNIT_SCHEMA_SHAPE = `{
  "refinedTitle": "optional clearer goal title; same language and intent",
  "topicScope": "focused|overview",
  "topicOverview": "2-3 sentences describing what this single lesson covers",
  "title": "focused lesson title",
  "difficulty": "easy|medium|hard",
  "contentSummary": "what the learner will study in this one session"
}`;

export function buildMicroUnitPrompt(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
  instantMode?: boolean;
}): string {
  const contextBlock = params.context
    ? `\n\nReference material:\n${params.context.slice(0, 8000)}`
    : "\n\nNo uploaded material — reason from widely accepted curricula for this topic.";
  const langNote = getLanguagePromptInstruction(params.contentLanguage);
  const optionsBlock = getGenerationOptionsPromptBlock(
    params.generationOptions,
  );

  const instantRules = params.instantMode
    ? `
INSTANT MICRO COURSE MODE (mandatory):
- Use the topicScope rules below: overview for broad subjects/fields; focused only when the goal is already a single concrete slice
- When topicScope is overview: difficulty MUST be medium (not easy) — teach substantive core concepts, not a shallow tour
- When topicScope is overview: contentSummary must name 4–6 specific core concepts to teach in this session, each with a definition and example
`
    : "";

  return `You are XueLearn's micro-course designer.
Design ONE learning session for a light course — not a multi-unit course, cognitive map, or syllabus.

User goal: ${params.title}
User level: ${params.level}
Path hints source: ${params.pathSource}
${contextBlock}
${optionsBlock ? `\n${optionsBlock}\n` : ""}
${langNote}
${instantRules}
First decide topicScope (default to overview unless the goal is clearly narrow):
- overview — DEFAULT for most light courses. Use when the goal names a subject, field, curriculum, language, tool ecosystem, or multi-topic area (even if the user adds words like "fundamentals" or "beginner"). Produce a core-concepts primer: map the landscape AND teach 4–6 foundational ideas with definitions and concrete examples—not a table of contents.
- focused — ONLY when the user goal is already a single concrete slice: one poem/work, one named concept, one chapter/technique, one interview question, or one narrowly scoped skill drill.

Examples:
- "Python" / "Python programming" / "Python fundamentals" → overview
- "machine learning" / "classical Chinese literature" / "blockchain" → overview
- "Analyze Du Fu's Spring View" → focused
- "React useEffect dependency array" → focused
- "Implement binary search" → focused

Rules:
- When unsure, choose overview.
- Output exactly one focused lesson.
- topicScope must be "focused" or "overview".
- focused: contentSummary is a concrete deep-dive scope for this session.
- overview: title and contentSummary frame a core-concepts primer; topicOverview explains what foundational ideas this session covers and what learners could explore next in a full map.
- overview on broad topics: difficulty should be medium for zero/beginner learners unless the topic is truly trivial.
- topicOverview: brief orientation for the learner (2-3 sentences).
- difficulty: match user level and topic depth.
- ${MICRO_COURSE_TITLE_PROMPT_RULE}

Required semantic fields (the caller supplies the wire-format contract):
${MICRO_UNIT_SCHEMA_SHAPE}
`;
}

function buildMicroUnitGenerationPrompt(
  params: Parameters<typeof buildMicroUnitPrompt>[0],
) {
  return `${buildMicroUnitPrompt(params)}

Use exactly two JSON-array items in this order:
1. {"kind":"metadata","refinedTitle":"optional","topicScope":"focused|overview","topicOverview":"..."}
2. {"kind":"lesson","title":"...","difficulty":"easy|medium|hard","contentSummary":"..."}
${MICRO_COURSE_TITLE_PROMPT_RULE}`;
}

export function createMicroUnitCapability() {
  const capabilityId = "micro-unit";
  const version = "1.0.0";
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [MICRO_UNIT_VIEW_KEYS.instructionContext]: async ({
        subject,
        invocation,
      }): Promise<ContextEnvelope | null> => {
        const input = invocation as
          Parameters<typeof buildMicroUnitPrompt>[0] | undefined;
        if (!input?.title || !input.level || !input.pathSource) return null;
        return {
          ownerCapabilityId: capabilityId,
          ownerCapabilityVersion: version,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: { promptBlock: buildMicroUnitGenerationPrompt(input) },
        };
      },
    },
  });
}

export async function generateMicroUnitStream(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
  instantMode?: boolean;
  onToken?: StreamTokenHandler;
  onPartialMicroUnit?: (partial: MicroUnitDslPreview) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<MicroUnitResult> {
  const parsed = await runValidatedStructuredGeneration<
    MicroUnitJitItem,
    MicroUnitDslPreview,
    MicroUnitResult
  >(
    {
      mode: "item-array",
      operation: "goal.micro_unit",
      prompt: "",
      itemSchema: microUnitJitItemSchema,
      resultSchema: microUnitJitItemsSchema.transform(assembleMicroUnitItems),
      assemble: (items) => items,
      assemblePartial: (items) => {
        const metadata = items.find((item) => item.kind === "metadata");
        const lesson = items.find((item) => item.kind === "lesson");
        const microUnit: Partial<MicroUnitResult> = {
          ...(metadata
            ? {
                refinedTitle: metadata.refinedTitle,
                topicScope: metadata.topicScope,
                topicOverview: metadata.topicOverview,
              }
            : {}),
          ...(lesson
            ? {
                title: lesson.title,
                difficulty: lesson.difficulty,
                contentSummary: lesson.contentSummary,
              }
            : {}),
        };
        const pendingFields = [
          "refinedTitle",
          "topicOverview",
          "title",
          "difficulty",
          "contentSummary",
        ].filter(
          (field) =>
            !(field in microUnit) ||
            microUnit[field as keyof MicroUnitResult] == null,
        );
        return { microUnit, pendingFields };
      },
      meta: {
        goalTitle: params.title,
        level: params.level,
        pathSource: params.pathSource,
        contentLanguage: params.contentLanguage,
        languageLabel: getContentLanguageLabel(params.contentLanguage),
      },
      contextSubject: {},
      contextQuery: params.title.slice(0, 2_000),
      contextInvocation: params,
    },
    {
      onToken: params.onToken,
      onPartial: params.onPartialMicroUnit,
      signal: params.signal,
    },
  );
  if (params.instantMode) {
    return {
      ...parsed,
      refinedTitle: parsed.refinedTitle
        ? sanitizeMicroCourseTitle(parsed.refinedTitle)
        : parsed.refinedTitle,
      title: sanitizeMicroCourseTitle(parsed.title),
    };
  }
  return {
    ...parsed,
    refinedTitle: parsed.refinedTitle
      ? sanitizeMicroCourseTitle(parsed.refinedTitle)
      : parsed.refinedTitle,
    title: sanitizeMicroCourseTitle(parsed.title),
  };
}
