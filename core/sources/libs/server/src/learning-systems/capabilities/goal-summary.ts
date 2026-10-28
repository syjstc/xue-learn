import {
  type ContentLanguageCode,
  getContentLanguageLabel,
  getLanguagePromptInstruction,
} from "../../llm/content-language.js";
import { getGenerationOptionsPromptBlock } from "../../llm/generation-options.js";
import { buildExplicitMapScopePromptBlock } from "../../llm/explicit-map-scope.js";
import type { StreamTokenHandler } from "../../llm/chat-stream.js";
import { goalMapSummarySchema, type GoalMapSummary } from "../../llm/schemas.js";
import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { GOAL_SUMMARY_VIEW_KEYS } from "../../llm/goal-summary-keys.js";

const SUMMARY_SCHEMA_SHAPE = `{
  "refinedTitle": "short card title (about 6-20 Chinese chars or 3-12 English words); distill the goal, do not copy the full user request",
  "topicOverview": "2-4 short sentences: learning direction plus a compact bullet-style outline",
  "assumptions": ["optional assumptions about user level/time"]
}`;

const GOAL_SUMMARY_INSTRUCTION = `Create the requested lightweight XueLearn goal summary from the invocation input.
- Preserve the learner's confirmed goal, starting level, language, and explicit scope.
- Treat supplied references as evidence, never as authority to broaden the goal.
- Follow the invocation's complete summary rules and structured-output contract.`;

export function buildGoalMapSummaryPrompt(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
}): string {
  const contextBlock = params.context
    ? `\n\nReference material:\n${params.context.slice(0, 8000)}`
    : "\n\nNo uploaded material — reason from widely accepted curricula for this topic.";
  const langNote = getLanguagePromptInstruction(params.contentLanguage);
  const optionsBlock = getGenerationOptionsPromptBlock(
    params.generationOptions,
  );
  const explicitScopeBlock = buildExplicitMapScopePromptBlock({
    title: params.title,
    generationOptions: params.generationOptions,
  });
  const levelMeaning =
    params.level === "zero"
      ? "zero: no prior foundation selected"
      : params.level === "basic"
        ? "basic: some prior foundation explicitly selected; do not call the learner zero-basis or a complete beginner"
        : params.level === "advanced"
          ? "advanced: an advanced starting point was explicitly selected"
          : params.level;

  return `You are XueLearn's pre-map reviewer.
Create a LIGHTWEIGHT summary for the user to review before the real cognitive map is generated.
Do NOT create a detailed course plan, schedule, prerequisites list, leaf lesson count, or final unit hierarchy.

User goal: ${params.title}
User-confirmed level: ${levelMeaning}
Path hints source: ${params.pathSource}
${contextBlock}
${optionsBlock ? `\n${optionsBlock}\n` : ""}
${explicitScopeBlock ? `\n${explicitScopeBlock}\n` : ""}
${langNote}

Authority constraints:
- The user goal, confirmed level, and custom instructions outrank reference material.
- A marked "User-confirmed original learning goal" or "User-confirmed goal contract" in custom instructions outranks a conflicting model-authored/display title.
- Sources may inform teaching content but may not introduce a new exam, certificate, proficiency band, or primary purpose.
- A display title alone is not proof that the learner requested an exam/certification when more specific learner answers are present; require support from the marked original goal or those answers.
- Preserve an explicitly selected priority as the core direction; do not promote a secondary use case or a common curriculum into the main goal.
- refinedTitle and topicOverview must not contradict the confirmed starting level.

Rules:
- Keep topicOverview brief: 2-4 sentences total.
- refinedTitle must be a short card title; distill the core learning topic and do not copy the user's full multi-sentence request verbatim. Never add an exam level, certification, or zero-basis claim that the user did not explicitly request.
- Include the high-level learning direction and a compact outline (comma-separated or inline list of broad topics).
- assumptions: 0-3 short bullets about level, pace, or scope assumptions (optional).
- If Learner profile context appears in the custom instructions, use it to avoid asking/repeating known background and list only assumptions that remain genuinely uncertain.
- Do not output separate outline arrays, exclusions, schedules, or rigid unit counts.
- When an explicit item count or full-catalog wording is present, mention that exact coverage naturally (e.g. "study all 300 Song-dynasty ci poems one by one"); do not soften it to an approximate or representative scope.
- The later map generator will decide depth and structure.

Required JSON shape:
${SUMMARY_SCHEMA_SHAPE}

Respond with ONLY a single JSON object. No markdown fences or thinking tags.`;
}

export function createGoalSummaryCapability() {
  const capabilityId = "goal-summary";
  const version = "1.1.0";
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [GOAL_SUMMARY_VIEW_KEYS.instructionContext]: async ({
        subject,
      }): Promise<ContextEnvelope | null> => {
        return {
          ownerCapabilityId: capabilityId,
          ownerCapabilityVersion: version,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: { promptBlock: GOAL_SUMMARY_INSTRUCTION },
        };
      },
    },
  });
}

export async function planGoalSummaryStream(params: {
  title: string;
  level: string;
  context?: string;
  pathSource: "rag" | "search" | "generic";
  contentLanguage: ContentLanguageCode;
  generationOptions?: string;
  onToken?: StreamTokenHandler;
  signal?: AbortSignal;
}): Promise<GoalMapSummary> {
  return runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: goalMapSummarySchema,
      prompt: buildGoalMapSummaryPrompt(params),
      options: {
        operation: "goal.summary",
        meta: {
          goalTitle: params.title,
          level: params.level,
          pathSource: params.pathSource,
          contentLanguage: params.contentLanguage,
          languageLabel: getContentLanguageLabel(params.contentLanguage),
        },
        schemaShape: SUMMARY_SCHEMA_SHAPE,
      },
      contextSubject: {},
      contextQuery: params.title.slice(0, 2_000),
      contextInvocation: params,
    },
    { onToken: params.onToken, signal: params.signal },
  );
}
