/** Codex/ChatGPT subscription image models exposed by the Codex Responses tool. */
export const CODEX_IMAGE_MODELS = [
  "gpt-image-2.5-flare",
  "gpt-image-2",
] as const;

export const DEFAULT_CODEX_IMAGE_MODEL = CODEX_IMAGE_MODELS[0];

/** The Responses request needs a Codex text model to host image_generation. */
export const CODEX_IMAGE_RESPONSES_MODEL = "gpt-5.6-sol";
