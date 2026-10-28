const TOOL_REPAIR_NARRATION_PATTERNS = [
  /\b(?:the )?tool (?:expects?|requires?|needs?)\b/i,
  /\b(?:tool|scene) parameters?\b.{0,80}\b(?:arguments?|wrapped|top-level|directly)\b/i,
  /\b(?:arguments?|parameters?)\b.{0,80}\b(?:wrapped|top-level|pass(?:ed)? directly)\b/i,
  /\b(?:let me|i(?:'ll| will)) (?:retry|try again|pass .{0,40} directly)\b/i,
  /工具.{0,24}(?:参数|调用|格式|重试)/,
  /(?:参数|场景).{0,24}(?:顶层|包装|重试|直接传递)/,
];

/**
 * Fail closed when a model narrates an internal tool-schema repair beside
 * rendered UI. Such text is transport/debug detail, never learner content.
 */
export function sanitizeToolUserFacingText(
  content: string,
  toolName?: string,
): string {
  const trimmed = content.trim();
  if (!trimmed || !toolName) return trimmed;
  return TOOL_REPAIR_NARRATION_PATTERNS.some((pattern) => pattern.test(trimmed))
    ? ""
    : trimmed;
}
