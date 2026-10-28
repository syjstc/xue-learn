export function fallbackGoalCoursePattern(params: {
  title: string;
  level: string;
}): string {
  const topic = params.title.toLowerCase();
  const isLanguageOrVocabulary =
    /\b(language|vocabulary|word|words|grammar|english|chinese|japanese|korean|spanish|french)\b/i.test(
      topic,
    ) ||
    /语言|词|单词|词汇|语法|英语|中文|日语|韩语|西语|法语/.test(params.title);

  if (isLanguageOrVocabulary) {
    return [
      "Pattern title: Reusable language item study pattern",
      "Recurring structure:",
      "1. Start with pronunciation or how to say/read the item.",
      "2. Explain the core meaning in plain learner-level language.",
      "3. Show common usage patterns, collocations, or grammar constraints.",
      "4. Provide short examples with translations or glosses when useful.",
      "5. End with a short production task or worked self-check cue in prose (not a quiz block).",
      "Block usage:",
      "- Use compact headings for pronunciation, meaning, usage, examples, and practice.",
      "- Use callouts for traps, register, or similar-word differences.",
      "- Leave graded questions to the later section mini-test; do not embed check blocks.",
      "Structural rules:",
      "- Repeat the same outline for similar words so the course reads like one coherent book.",
      "- Keep examples and checks in the same relative position for each word.",
      "- Keep each item capability-scoped and focused.",
      "Context reuse rules:",
      "- Introduce shared grammar notes, word-family patterns, or register conventions once in the first relevant lesson or a short overview module.",
      "- Later word/item lessons focus on pronunciation, meaning, usage, and examples for that item only; reference shared rules briefly instead of reteaching them.",
      "- Do not repeat full grammar-family or etymology background in every vocabulary unit unless this unit introduces a genuinely new angle.",
    ].join("\n");
  }

  return [
    "Pattern title: Reusable concept lesson pattern",
    "Recurring structure:",
    "1. Open with the concept's purpose and why it matters.",
    "2. Define the idea with a concise mental model.",
    "3. Walk through the key mechanics or steps.",
    "4. Show concrete examples and non-examples.",
      "5. Add a short practice cue and summary takeaway.",
      "Block usage:",
      "- Use headings, short paragraphs, examples, and callouts.",
      "- Use compare panels for similar concepts and callouts for pitfalls.",
      "Structural rules:",
      "- Similar units should reuse this outline while adapting examples to the specific topic.",
      "- Leave graded questions to the later section mini-test; keep teaching blocks free of check/quiz blocks.",
    "- Keep each lesson capability-scoped and focused.",
    "Context reuse rules:",
    "- Identify recurring entities across similar units (author, historical period, dynasty, technique family, shared framework) and introduce that common background once in the first relevant lesson or a dedicated overview module.",
    "- Later item-specific units focus on the unique work, text, imagery, theme, or practice for that item; only include a brief reminder of shared background when it directly supports the current unit.",
    "- Do not repeat full biographies, era surveys, or shared technique primers in every similar unit unless the current unit needs a new angle on that background.",
  ].join("\n");
}
