/**
 * highlight.js language ids we prompt for and repair toward.
 * Keep in sync with web/mobile highlight registration (minus markdown).
 */
export const HIGHLIGHT_CODE_LANGUAGE_IDS = [
  "rust",
  "python",
  "javascript",
  "typescript",
  "java",
  "go",
  "bash",
  "sql",
  "json",
  "yaml",
  "cpp",
  "csharp",
  "kotlin",
  "swift",
  "php",
  "ruby",
  "c",
  "css",
  "xml",
  "diff",
  "dockerfile",
  "graphql",
  "ini",
  "lua",
  "makefile",
  "objectivec",
  "perl",
  "powershell",
  "r",
  "scala",
  "scss",
  "vbnet",
  "wasm",
] as const;

export type HighlightCodeLanguageId =
  (typeof HIGHLIGHT_CODE_LANGUAGE_IDS)[number];

/** Non-code fence info strings that must never be overwritten by repair. */
export const RESERVED_FENCE_LANGUAGE_IDS = [
  "math",
  "latex",
  "tex",
  "flowchart",
  "mermaid",
  "graph",
] as const;

/** LLM placeholder tags — treat like a missing language. */
export const PLACEHOLDER_FENCE_LANGUAGE_IDS = [
  "xxx",
  "code",
  "lang",
  "language",
  "plaintext",
  "plain",
  "text",
  "txt",
  "example",
  "snippet",
  "source",
  "output",
  "console",
] as const;

const LANGUAGE_ALIASES: Record<string, HighlightCodeLanguageId> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  html: "xml",
  htm: "xml",
  svg: "xml",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  docker: "dockerfile",
  gql: "graphql",
  make: "makefile",
  mm: "objectivec",
  objc: "objectivec",
  ps1: "powershell",
  pwsh: "powershell",
  toml: "ini",
};

const HIGHLIGHT_SET = new Set<string>(HIGHLIGHT_CODE_LANGUAGE_IDS);
const RESERVED_SET = new Set<string>(RESERVED_FENCE_LANGUAGE_IDS);
const PLACEHOLDER_SET = new Set<string>(PLACEHOLDER_FENCE_LANGUAGE_IDS);

/** Prompt-facing comma list of highlight.js ids. */
export function formatHighlightCodeLanguagePromptList(): string {
  return HIGHLIGHT_CODE_LANGUAGE_IDS.join(", ");
}

/** Canonical highlight id, or undefined if unknown. */
export function resolveHighlightCodeLanguage(
  language?: string | null,
): HighlightCodeLanguageId | undefined {
  if (!language) return undefined;
  const normalized = language.trim().toLowerCase();
  if (!normalized) return undefined;
  const resolved = LANGUAGE_ALIASES[normalized] ?? normalized;
  return HIGHLIGHT_SET.has(resolved)
    ? (resolved as HighlightCodeLanguageId)
    : undefined;
}

export function isReservedFenceLanguage(language?: string | null): boolean {
  const normalized = language?.trim().toLowerCase() ?? "";
  return Boolean(normalized) && RESERVED_SET.has(normalized);
}

export function isPlaceholderFenceLanguage(language?: string | null): boolean {
  const normalized = language?.trim().toLowerCase() ?? "";
  return Boolean(normalized) && PLACEHOLDER_SET.has(normalized);
}

/**
 * True when the fence opener should keep its info string as-is
 * (known highlight id, reserved math/graph tag, or non-placeholder unknown).
 */
export function shouldKeepFenceLanguage(language?: string | null): boolean {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  if (isReservedFenceLanguage(normalized)) return true;
  if (resolveHighlightCodeLanguage(normalized)) return true;
  if (isPlaceholderFenceLanguage(normalized)) return false;
  // Unknown non-placeholder tags (e.g. "diff", "dockerfile") — leave alone.
  return true;
}
