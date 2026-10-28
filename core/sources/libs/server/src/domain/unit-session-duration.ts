/** Comparisons use the same subviews as every other multi-part display. */
export function courseMaterialSubviewRequirements(hasLearnerProfile: boolean): string {
  const profileHint = hasLearnerProfile
    ? " When useful, bridge from the learner's familiar knowledge to the new idea."
    : "";
  return `For a useful comparison, compose a stage from 2–4 ordinary subviews (callout, code, illustration, or another supported figure). Give each subview a stable id and explain its content and the relationship through cues. Choose the layout and media to fit the teaching object; do not force two text cards or a VS relationship. Never emit the retired compare block, including inside a stage. There is no comparison quota.${profileHint}`;
}

export function overviewMaterialBlockRequirements(): string {
  const blockLow = 18;
  const blockHigh = 28;
  const blockMax = 36;

  return `- Aim for ${blockLow}–${blockHigh} blocks total for this single overview lesson. Hard limit: at most ${blockMax} blocks.
- Under EACH top-level branch heading, include multiple paragraphs plus at least one callout or accordion — enough depth for orientation, not deep mastery.
- Do not use material "check" blocks.
- Include at least 2 accordions and 2 definition/example callouts across the lesson when helpful.`;
}

/** Block targets for standalone broad-topic primers (micro / instant micro, no map yet). */
export function coreConceptsPrimerMaterialBlockRequirements(): string {
  const blockLow = 22;
  const blockHigh = 32;
  const blockMax = 40;
  const checkMin = 2;

  return `- Aim for ${blockLow}–${blockHigh} blocks for this core-concepts primer. Hard limit: at most ${blockMax} blocks.
- Under EACH core-concept heading: define key terms, explain why the idea matters, include at least one concrete mini-example, and connect to other concepts in the lesson.
- Include at least ${checkMin} material "check" blocks distributed through the lesson for retrieval practice.
- Include at least 4 callouts (definitions/examples) and 1 accordion when useful.`;
}
