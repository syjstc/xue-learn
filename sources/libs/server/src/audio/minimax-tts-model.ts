/** MiniMax interjection tags — only honored by speech-2.8-hd / speech-2.8-turbo. */
export const MINIMAX_TTS_EXPRESSION_TAGS = [
  "(laughs)",
  "(chuckle)",
  "(coughs)",
  "(clear-throat)",
  "(groans)",
  "(breath)",
  "(pant)",
  "(inhale)",
  "(exhale)",
  "(gasps)",
  "(sniffs)",
  "(sighs)",
  "(snorts)",
  "(burps)",
  "(lip-smacking)",
  "(humming)",
  "(hissing)",
  "(emm)",
  "(sneezes)",
] as const;

export const MINIMAX_TTS_MODELS_WITH_EXPRESSION_TAGS = [
  "speech-2.8-hd",
  "speech-2.8-turbo",
] as const;

export type MinimaxTtsModelWithExpressionTags =
  (typeof MINIMAX_TTS_MODELS_WITH_EXPRESSION_TAGS)[number];

export const DEFAULT_MINIMAX_TTS_MODEL: MinimaxTtsModelWithExpressionTags =
  "speech-2.8-turbo";

const EXPRESSION_TAG_PATTERN = new RegExp(
  MINIMAX_TTS_EXPRESSION_TAGS.map((tag) =>
    tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|"),
  "gi",
);

export function resolveMinimaxTtsModel(model?: unknown): string {
  if (typeof model === "string" && model.trim()) {
    return model.trim();
  }
  return DEFAULT_MINIMAX_TTS_MODEL;
}

export function supportsMinimaxTtsExpressionTags(model?: unknown): boolean {
  const resolved = resolveMinimaxTtsModel(model);
  return (MINIMAX_TTS_MODELS_WITH_EXPRESSION_TAGS as readonly string[]).includes(
    resolved,
  );
}

export function stripMinimaxTtsExpressionTags(text: string): string {
  return text
    .replace(EXPRESSION_TAG_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
