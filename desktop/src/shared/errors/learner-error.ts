const TECHNICAL_GENERATION_ERROR =
  /structured generation failed|invalid structured output|(?:^|\s)[a-z][a-z0-9_.-]+\s+structured generation/i;

export function learnerFacingError(
  error: string,
  options: { dev?: boolean } = {},
): string {
  if (!TECHNICAL_GENERATION_ERROR.test(error)) return error;
  if (options.dev ?? import.meta.env.DEV) return error;
  return "内容准备暂时遇到问题，请点击重新生成再试一次。";
}
