const TECHNICAL_GENERATION_ERROR =
  /structured generation failed|invalid structured output|KACOM path|(?:^|\s)[a-z][a-z0-9_.-]+\s+structured generation/i;

export function learnerFacingError(
  error: string,
  options: { dev?: boolean } = {},
): string {
  if (/KACOM path|approved prerequisite/i.test(error))
    return "测验准备时未能完整匹配课程的前置能力，请重新准备测验。已生成的学习内容仍可继续阅读。";
  if (!TECHNICAL_GENERATION_ERROR.test(error)) return error;
  if (options.dev ?? import.meta.env.DEV) return error;
  return "内容准备暂时遇到问题，请点击重新生成再试一次。";
}
