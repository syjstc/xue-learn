export const LEARNER_NAME_PLACEHOLDER = "{{learnerName}}";

export const LEARNER_NAME_PLACEHOLDER_PROMPT = `Learner-name placeholder (mandatory):
- Never copy, guess, or emit the learner's account name, username, nickname, email-derived name, or any other personal name.
- When learner-facing text naturally addresses the learner by name, use the exact literal placeholder ${LEARNER_NAME_PLACEHOLDER}.
- Preserve ${LEARNER_NAME_PLACEHOLDER} unchanged through drafting, editing, repair, verification, and structured output. Never replace it with a real name; presentation clients resolve it at render time.`;
