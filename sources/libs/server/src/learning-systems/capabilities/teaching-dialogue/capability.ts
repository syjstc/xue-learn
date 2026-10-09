import { defineLearningSystemCapability } from "../../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../../types.js";
import { TEACHING_DIALOGUE_VIEW_KEYS } from "./keys.js";

/** Byte-stable Socratic rules shared by unit.socratic and unit.socratic.feedback. */
export const SOCRATIC_SHARED_POLICY = `Socratic correction policy (server-authoritative):
- Guide with exactly one question or hint when the learner is still wrong. Do not give the direct answer.
- When the learner's own latest answer demonstrates corrected understanding: explicitly tell them they are correct, give a concise summary of the corrected understanding, and do not ask another question.
- After turn 4 without resolution: clearly close the correction and summarize the key point instead of asking another question. A turn limit is never evidence of resolution.
- Resolution metadata (rs / dn / et):
  - rs: true only when the learner's own latest answer demonstrates corrected understanding
  - dn: true when rs=true, or when the dialogue must close at the turn limit
  - et: careless | concept | prerequisite when an error type applies; otherwise omit / none
- Never invent learner understanding from the tutor's words alone. Tutor hints are not evidence of rs=true.`;

const TEACHING_DIALOGUE_OPERATION_INSTRUCTIONS = Object.freeze({
  [TEACHING_DIALOGUE_VIEW_KEYS.quizExplainInstructionContext]:
    "Explain one graded quiz question using the supplied answer record and trusted references, including why the correct choice fits and why each distractor does not; do not change scoring or evidence.",
  [TEACHING_DIALOGUE_VIEW_KEYS.socraticPolicyContext]: SOCRATIC_SHARED_POLICY,
  // Shared thin instruction so dialogue + feedback keep an identical operation
  // layer in the composed prefix; mode-specific work stays in the invocation.
  [TEACHING_DIALOGUE_VIEW_KEYS.socraticInstructionContext]:
    "Apply the Socratic correction policy for this unit turn. Dialogue turns reply in natural language then submit metadata through the required tool; feedback-only repairs return structured metadata only.",
  [TEACHING_DIALOGUE_VIEW_KEYS.socraticFeedbackInstructionContext]:
    "Apply the Socratic correction policy for this unit turn. Dialogue turns reply in natural language then submit metadata through the required tool; feedback-only repairs return structured metadata only.",
});

export function buildTeachingDialogueInvocationPrompt(
  key: string,
  invocation: unknown,
): string | null {
  const input = invocation as Record<string, unknown> | undefined;
  if (
    key === TEACHING_DIALOGUE_VIEW_KEYS.quizExplainInstructionContext &&
    typeof input?.unitTitle === "string"
  ) {
    return `You are a concise tutor for unit "${input.unitTitle}".
The learner has submitted this graded quiz question. Use concise plain markdown.

Explain:
1) why the correct answer fits the concept,
2) why every other option is not correct (combine equivalent distractors only when helpful),
3) if the learner was wrong or partially correct, identify the specific misunderstanding; if correct, reinforce the key distinction.

Prefer a short conclusion followed by compact option-by-option bullets. Stay under 240 words. Be direct and encouraging. Do not repeat the full question text.
${String(input.languageInstruction ?? "")}

${String(input.questionBlock ?? "")}${String(input.referenceBlock ?? "")}`;
  }
  if (
    key === TEACHING_DIALOGUE_VIEW_KEYS.socraticInstructionContext &&
    typeof input?.unitTitle === "string"
  ) {
    const weakTags = Array.isArray(input.weakTags)
      ? input.weakTags.join(", ")
      : "general";
    const turn = Number(input.turn ?? 0);
    const priorBlock = input.priorContext
      ? `\nPrior learner errors / focus:\n${String(input.priorContext)}\n`
      : "";
    const answerBlock =
      input.lastAnswer != null && input.lastAnswer !== ""
        ? `\nLearner's latest answer: ${String(input.lastAnswer)}\n`
        : turn === 0
          ? "\nThe learner has not replied yet. Open with ONE guiding question grounded in their mistake.\n"
          : "";
    return `Mode: dialogue turn
Unit: ${input.unitTitle}
Weak areas: ${weakTags || "general"}
Turn: ${turn}.${priorBlock}${answerBlock}
Reply in natural language only. Do NOT output JSON in your text reply.
After your reply, call submit_socratic_feedback with rs, dn, and optional et.
${String(input.languageBlock ?? "")}`;
  }
  if (
    key === TEACHING_DIALOGUE_VIEW_KEYS.socraticFeedbackInstructionContext &&
    typeof input?.unitTitle === "string"
  ) {
    return `Mode: feedback metadata repair
Unit: ${input.unitTitle}
Turn: ${String(input.turn ?? 0)}
Learner's latest answer: ${String(input.lastAnswer ?? "(none)")}
Tutor reply: ${String(input.assistantText ?? "")}
Return one structured object with rs, dn, and et (use none when no error type applies).`;
  }
  return null;
}

export function createTeachingDialogueCapability() {
  const capabilityId = "teaching-dialogue";
  const version = "1.0.0";
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: Object.fromEntries(
      Object.values(TEACHING_DIALOGUE_VIEW_KEYS).map((key) => [
        key,
        async ({
          subject,
        }: SystemViewRequest): Promise<ContextEnvelope | null> => {
          const operationInstruction =
            TEACHING_DIALOGUE_OPERATION_INSTRUCTIONS[
              key as keyof typeof TEACHING_DIALOGUE_OPERATION_INSTRUCTIONS
            ];
          return operationInstruction
            ? {
                ownerCapabilityId: capabilityId,
                ownerCapabilityVersion: version,
                schemaVersion: 1,
                authority: "server_policy",
                scope: { ...subject },
                freshness: {
                  asOf: new Date(0).toISOString(),
                  stale: false,
                },
                data: { promptBlock: operationInstruction },
              }
            : null;
        },
      ]),
    ),
  });
}
