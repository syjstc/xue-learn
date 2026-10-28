/**
 * Broad top-level topic categories for learning goals.
 * Chosen during cognitive-map planning; drives specialist content markup profiles.
 */
export const TOPIC_CATEGORIES = [
  "language",
  "mathematics",
  "natural_science",
  "computer_science",
  "engineering",
  "humanities",
  "social_science",
  "music",
  "arts",
  "business",
  "health_medicine",
  "professional",
  "general",
] as const;

export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const TOPIC_CATEGORY_SET = new Set<string>(TOPIC_CATEGORIES);

export function isTopicCategory(value: unknown): value is TopicCategory {
  return typeof value === "string" && TOPIC_CATEGORY_SET.has(value);
}

export function normalizeTopicCategory(
  value: unknown,
  fallback: TopicCategory = "general",
): TopicCategory {
  return isTopicCategory(value) ? value : fallback;
}

/** Topic categories where numeric models, charts, and param simulators are appropriate. */
export const QUANTITATIVE_TOPIC_CATEGORIES = [
  "mathematics",
  "natural_science",
  "computer_science",
  "engineering",
  "health_medicine",
] as const satisfies readonly TopicCategory[];

const QUANTITATIVE_TOPIC_CATEGORY_SET = new Set<string>(
  QUANTITATIVE_TOPIC_CATEGORIES,
);

export function isQuantitativeTopicCategory(
  category: TopicCategory | null | undefined,
): boolean {
  return (
    category != null && QUANTITATIVE_TOPIC_CATEGORY_SET.has(category)
  );
}

/** Specialist markup profiles enabled per topic category. */
export type ContentMarkupProfile = "language" | "stem";

export function contentMarkupProfilesForTopicCategory(
  category: TopicCategory | null | undefined,
): ContentMarkupProfile[] {
  switch (category) {
    case "language":
      return ["language"];
    case "mathematics":
    case "natural_science":
    case "computer_science":
    case "engineering":
    case "health_medicine":
      return ["stem"];
    default:
      return [];
  }
}

/** Prompt-facing labels for plan-time category selection. */
export const TOPIC_CATEGORY_PROMPT_LINES: readonly string[] = [
  "language — foreign/modern language learning, literacy, communicative competence (not general history or literature study)",
  "mathematics — pure/applied math, statistics, quantitative reasoning",
  "natural_science — physics, chemistry, biology, earth/environmental science",
  "computer_science — programming, algorithms, software, CS theory",
  "engineering — applied engineering disciplines and technical design",
  "humanities — history, philosophy, literature, cultural studies (non-language-focus)",
  "social_science — psychology, sociology, political science, economics",
  "music — music theory, listening, score reading, musical performance and composition; enables music displays only when sound or notation is necessary evidence",
  "arts — visual arts, theatre, non-musical performance, creative practice",
  "business — management, marketing, finance, entrepreneurship skills",
  "health_medicine — medicine, nursing, anatomy, clinical topics",
  "professional — law, certifications, trade skills, job workflows",
  "general — broad or mixed goals without a specialist markup profile",
];
