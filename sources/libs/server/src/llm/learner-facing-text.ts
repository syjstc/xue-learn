const INTERNAL_LEARNING_TARGET_REF_LIST =
  /\blt_\d+(?::c\d+)?\b(?:\s*(?:、|，|,|和|及|与|and|&|\/|\+)\s*\blt_\d+(?::c\d+)?\b)*/giu;

export const COURSE_LEARNER_FACING_CONTENT_INSTRUCTION = `Learner-facing content and internal authoring context:
- Internal topic/section/target/formula keys, component refs, payload names and generation workflow are metadata, not lesson copy. Use readable concept names and the actual fact or condition in introductions, titles, board text, labels, captions, narration and takeaways.
- Apply planning, coverage and continuity instructions silently. Never publish authoring notes such as "reuse the existing topic", "do not reteach the definition", "已接受的主题" or "不重教定义". A bridge should state the relevant earlier result and apply it, rather than describe how this lesson is being generated.
- Actual program identifiers, source code and mathematical notation that are the teaching evidence must stay intact. Do not remove an identifier merely because it contains an underscore.
- Before committing, inspect every learner-facing string. If internal context leaked, rewrite the full sentence into substantive teaching while preserving its facts, examples and qualifications; do not simply delete tokens.`;

/** Remove server-owned target refs from text that can reach a learner. */
export function stripInternalLearningTargetRefs(value: string): string {
  return value
    .replace(INTERNAL_LEARNING_TARGET_REF_LIST, "")
    .replace(/\s+的(?=\p{Script=Han})/gu, "")
    .replace(/\(\s*\)|（\s*）/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。！？；：,.!?;:])/gu, "$1")
    .trim();
}
