const SOURCE_CODE_LANGUAGES = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "go",
  "java",
  "javascript",
  "js",
  "kotlin",
  "php",
  "python",
  "py",
  "ruby",
  "rust",
  "sql",
  "swift",
  "typescript",
  "ts",
]);

const FENCED_CODE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

/**
 * Generated lessons should never flatten a substantial source snippet into
 * one physical line. Besides being unreadable, this commonly turns otherwise
 * valid block-structured code into invalid source.
 *
 * Keep this check narrow: short one-line examples, JSON, terminal output,
 * graphs, and math fences remain valid.
 */
export function hasCollapsedGeneratedCodeFence(text: string): boolean {
  for (const match of text.matchAll(FENCED_CODE_RE)) {
    const language = match[1]?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const body = match[2]?.trim() ?? "";
    if (
      SOURCE_CODE_LANGUAGES.has(language) &&
      body.length >= 120 &&
      !body.includes("\n")
    ) {
      return true;
    }
  }
  return false;
}

/** Walk provider-authored block fields without coupling this rule to a type. */
export function containsCollapsedGeneratedCodeFence(value: unknown): boolean {
  if (typeof value === "string") return hasCollapsedGeneratedCodeFence(value);
  if (Array.isArray(value)) {
    return value.some(containsCollapsedGeneratedCodeFence);
  }
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsCollapsedGeneratedCodeFence);
}
