import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { TITLE_REFINEMENT_VIEW_KEYS } from "../../goals/title-refinement-keys.js";

export const TITLE_REFINEMENT_CAPABILITY_ID = "goal-title-refinement" as const;
export const TITLE_REFINEMENT_CAPABILITY_VERSION = "1.0.0" as const;

const TITLE_REFINEMENT_INSTRUCTION = `Analyze the learning goal in the invocation input and return the declared output contract.
- topic: preserve the learner's original description.
- refinedTitle: a short, clear card title for the core subject (about 6–20 characters in Chinese or 3–12 words in English; use the input language).
- intentAnalysis: one sentence analyzing the learner's intent.

Extract the central subject rather than copying the full request. Exclude requirement lists, lesson counts, language levels, and course quantities. Do not add exams, certificates, proficiency levels, admissions/job goals, or beginner status unless explicitly stated. A familiar course name must not replace the learner's intent. Combine multiple requirements into one coherent topic.`;

export function createGoalTitleRefinementCapability() {
  return defineLearningSystemCapability({
    id: TITLE_REFINEMENT_CAPABILITY_ID,
    version: TITLE_REFINEMENT_CAPABILITY_VERSION,
    kind: "learning_system",
    views: {
      [TITLE_REFINEMENT_VIEW_KEYS.instruction]: async ({
        subject,
      }): Promise<ContextEnvelope> => ({
        ownerCapabilityId: TITLE_REFINEMENT_CAPABILITY_ID,
        ownerCapabilityVersion: TITLE_REFINEMENT_CAPABILITY_VERSION,
        schemaVersion: 1,
        authority: "server_policy",
        scope: { ...subject },
        freshness: { asOf: new Date(0).toISOString(), stale: false },
        data: { promptBlock: TITLE_REFINEMENT_INSTRUCTION },
      }),
    },
  });
}
