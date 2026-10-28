/** MiniMax-M3 supports `thinking.type: disabled`; M2.x always emit thinking. */
export function minimaxThinkingConfigurable(model: string): boolean {
  return /^MiniMax-M3$/i.test(model.trim());
}

/**
 * LangChain `modelKwargs` merge at the request root (same effect as OpenAI SDK
 * `extra_body` in Python). Do not nest under an `extra_body` key — MiniMax ignores it.
 *
 * `reasoning_split` keeps thinking in `reasoning_details` so message `content`
 * can stream as JSON instead of waiting behind `<think>` tags.
 */
export function minimaxThinkingModelKwargs(
  model: string,
  enabled: boolean,
): Record<string, unknown> {
  const kwargs: Record<string, unknown> = { reasoning_split: true };
  if (minimaxThinkingConfigurable(model) && !enabled) {
    kwargs.thinking = { type: "disabled" };
  }
  return kwargs;
}
