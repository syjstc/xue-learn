import { z } from "zod";
import {
  type ContentLanguageCode,
  getContentLanguageLabel,
  getLanguagePromptInstruction,
} from "../../llm/content-language.js";
import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { resolveRefinedGoalTitle } from "../../goals/refine-goal-title.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { MICRO_TITLE_VIEW_KEYS } from "../../goals/micro-title-keys.js";

const broadenTitleSchema = z.object({
  refinedTitle: z.string().min(2),
});

const BROADEN_TITLE_SCHEMA_SHAPE = `{
  "refinedTitle": "broader learning goal title for a multi-unit course map"
}`;

export function buildBroadenMicroGoalTitlePrompt(params: {
  goalTitle: string;
  unitTitle: string;
  contentSummary: string;
  topicOverview?: string | null;
  contentLanguage: ContentLanguageCode;
}): string {
  const overview = params.topicOverview?.trim();
  const langNote = getLanguagePromptInstruction(params.contentLanguage);

  return `You are XueLearn's goal title refiner.
A micro (single-lesson) course is being converted into a full learning map with multiple units.
The current goal title may be as narrow as one lesson — decide whether it already describes a multi-unit course, and if not, broaden it to the parent category level of the original title.

Current goal title: ${params.goalTitle}
Micro lesson title: ${params.unitTitle}
Lesson scope: ${params.contentSummary}
${overview ? `Topic overview: ${overview}` : ""}
${langNote}

When the title is too narrow (single poem/chapter/concept/skill/example/lesson), broaden it one level up to the natural parent topic that could contain many lessons — not the whole discipline.
Examples (narrow → parent-level goal):
- "Analyze Du Fu's Spring View" → "Du Fu poetry appreciation" or "Major Tang poems"
- "React useEffect deep dive" → "React Hooks fundamentals"
- "Implement binary search" → "search algorithms"
- "English present perfect" → "English tenses"

Rules:
- If the current goal title already fits a multi-unit course, return it unchanged in refinedTitle
- Otherwise broaden to the parent category of the original title (same subject area and learning intent)
- Broader than a single lesson; the micro lesson will become one unit under this goal
- Same language as the inputs
- Clear and concise
- Do not copy the micro lesson title verbatim unless it already describes a broad topic

Required JSON shape:
${BROADEN_TITLE_SCHEMA_SHAPE}

Respond with ONLY a single JSON object. No markdown fences or thinking tags.`;
}

export function createMicroTitleCapability() {
  const capabilityId = "micro-title";
  const version = "1.0.0";
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [MICRO_TITLE_VIEW_KEYS.broadenInstructionContext]: async ({
        subject,
        invocation,
      }): Promise<ContextEnvelope | null> => {
        const input = invocation as
          Parameters<typeof buildBroadenMicroGoalTitlePrompt>[0] | undefined;
        if (!input?.goalTitle || !input.unitTitle || !input.contentSummary) {
          return null;
        }
        return {
          ownerCapabilityId: capabilityId,
          ownerCapabilityVersion: version,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: { promptBlock: buildBroadenMicroGoalTitlePrompt(input) },
        };
      },
    },
  });
}

/** Broaden a micro-course goal title before converting it into a full learning map. */
export async function broadenMicroGoalTitleForConversion(params: {
  userId?: string;
  goalId?: string;
  goalTitle: string;
  unitTitle: string;
  contentSummary: string;
  topicOverview?: string | null;
  contentLanguage: ContentLanguageCode;
  signal?: AbortSignal;
}): Promise<{ title: string; changed: boolean }> {
  const result = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: broadenTitleSchema,
      prompt: "",
      options: {
        operation: "goal.micro_convert.title",
        meta: {
          goalTitle: params.goalTitle,
          unitTitle: params.unitTitle,
          contentLanguage: params.contentLanguage,
          languageLabel: getContentLanguageLabel(params.contentLanguage),
        },
        schemaShape: BROADEN_TITLE_SCHEMA_SHAPE,
      },
      contextSubject:
        params.userId || params.goalId
          ? { userId: params.userId, goalId: params.goalId }
          : {},
      contextQuery:
        `${params.goalTitle}: ${params.unitTitle} — ${params.contentSummary}`.slice(
          0,
          2_000,
        ),
      contextInvocation: params,
    },
    { signal: params.signal },
  );

  return resolveRefinedGoalTitle(params.goalTitle, result.refinedTitle);
}
