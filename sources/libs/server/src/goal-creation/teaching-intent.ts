import { createHash } from "node:crypto";
import {
  goalTeachingIntentSchema,
  formatDeterministicPromptValue,
} from "../agents/goal-creation/contract.js";
import type { GoalCreationState } from "../agents/goal-creation/state.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { GOAL_DIRECTED_TEACHING_POLICY } from "./teaching-policy.js";
import {
  resolveGoalContentLanguage,
  getLanguagePromptInstruction,
} from "../llm/content-language.js";

export function teachingIntentSource(state: GoalCreationState): string {
  return formatDeterministicPromptValue({
    originalRequest: state.topic,
    startingLevel: state.level,
    questions: state.discoveryQuestions,
    answers: state.discoveryAnswers,
    correctionsAndConstraints: state.generationOptions,
    contentLanguage: state.contentLanguage,
  });
}
export function teachingIntentSourceHash(state: GoalCreationState): string {
  return createHash("sha256").update(teachingIntentSource(state)).digest("hex");
}

/** Resolve the destination BEFORE the existing learner confirmation, never after approval. */
export async function resolveTeachingIntent(
  state: GoalCreationState,
  input: { userId: string; threadId: string; signal?: AbortSignal },
) {
  const sourceHash = teachingIntentSourceHash(state);
  if (state.teachingIntent && state.teachingIntentSourceHash === sourceHash) {
    return {
      teachingIntent: state.teachingIntent,
      teachingIntentSourceHash: sourceHash,
    };
  }
  const teachingIntent = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: goalTeachingIntentSchema,
      prompt: `${GOAL_DIRECTED_TEACHING_POLICY}
Resolve a reviewable learning destination from this learner's request and answers. This is a proposal for their existing confirmation card, not a claim of their consent or mastery. Separate starting level from destination. Preserve explicit exclusions. Express observable outcomes as tasks a learner can demonstrate; each bridge says what foundation is taught before which application. Do not invent a desired qualification, time budget, or examination. If the exact destination is unspecified, describe a conservative concrete outcome without claiming the learner specified it.
${getLanguagePromptInstruction(resolveGoalContentLanguage(state.contentLanguage, state.topic))}
Learner input:
${teachingIntentSource(state)}`,
      options: {
        operation: "agent.goal_creation.intent",
        bindingSchema: goalTeachingIntentSchema,
        meta: { threadId: input.threadId },
      },
      contextSubject: { userId: input.userId, threadId: input.threadId },
      contextQuery: state.topic.slice(0, 2_000),
    },
    { signal: input.signal },
  );
  return { teachingIntent, teachingIntentSourceHash: sourceHash };
}
