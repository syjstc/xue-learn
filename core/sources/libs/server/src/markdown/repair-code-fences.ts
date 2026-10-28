import {
  isPlaceholderFenceLanguage,
  isReservedFenceLanguage,
  resolveHighlightCodeLanguage,
  shouldKeepFenceLanguage,
  type HighlightCodeLanguageId,
} from "./code-fence-languages.js";

export type RepairCodeFencesOptions = {
  /** Soft prior when body heuristics cannot decide (e.g. goal primary language). */
  defaultLanguage?: string | null;
};

const LATEX_COMMAND_RE = /\\[a-zA-Z]+/;
const PYTHON_SIMPLE_STATEMENT =
  /^(?:(?:async\s+)?(?:class|def)\s+[A-Za-z_]\w*|(?:print|input)\s*\(|(?:assert|raise|return|yield|del|import|from|global|nonlocal|pass|break|continue)\b|(?:self\.)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*|\[[^\]]+\])*(?:\s*,\s*[A-Za-z_]\w*)*\s*(?::\s*[^=]+?)?\s*(?:\+=|-=|\*=|\/=|%=|\/\/=|\*\*=|&=|\|=|\^=|>>=|<<=|=(?!=))|(?:super\(\)(?:\.[A-Za-z_]\w*)+|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\s*\()/;

function pythonIndentLevel(statement: string, currentLevel: number): number {
  if (/^(?:async\s+)?class\b/.test(statement)) return 0;
  if (/^(?:async\s+)?def\b/.test(statement)) return 1;
  return currentLevel;
}

function formatCollapsedPython(body: string): string {
  if (body.includes("\n")) return body;

  const chunks: string[] = [];
  let start = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || !/\s/.test(char)) continue;

    let next = index;
    while (next < body.length && /\s/.test(body[next]!)) next += 1;
    if (
      next >= body.length ||
      !PYTHON_SIMPLE_STATEMENT.test(body.slice(next))
    ) {
      index = next - 1;
      continue;
    }
    const previous = body.slice(start, index).trim();
    if (!previous) {
      index = next - 1;
      continue;
    }
    // A call after an operator belongs to the current expression, not a new
    // statement (`value = nn.Dropout(...)`, `return x + self.layer(...)`).
    if (/(?:[=+\-*/%&|^<>]|:=)\s*$/.test(previous)) {
      index = next - 1;
      continue;
    }
    chunks.push(previous);
    start = next;
    index = next - 1;
  }

  const tail = body.slice(start).trim();
  if (tail) chunks.push(tail);
  if (chunks.length <= 1) return body;

  let indentLevel = 0;
  return chunks
    .map((chunk) => {
      indentLevel = pythonIndentLevel(chunk, indentLevel);
      const line = `${"    ".repeat(indentLevel)}${chunk}`;
      if (/^(?:async\s+)?class\b/.test(chunk)) indentLevel = 1;
      else if (/^(?:async\s+)?def\b/.test(chunk)) indentLevel = 2;
      return line;
    })
    .join("\n");
}

export function formatCollapsedCodeBody(language: string, body: string): string {
  const canonical = canonicalizeLanguage(language);
  if (canonical === "python") return formatCollapsedPython(body);
  if (canonical === "json" && !body.includes("\n")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

/** Same math-disguise heuristics as normalize-latex-math (keep in sync). */
function extractMathLatexFromCodeBody(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const prefixed = trimmed.match(/^math(?:\s+|\s*\n+)([\s\S]+)$/i);
  if (prefixed) {
    const latex = prefixed[1]?.trim() ?? "";
    return LATEX_COMMAND_RE.test(latex) ? latex : null;
  }

  if (
    /^\\begin\{[a-zA-Z*]+\}/.test(trimmed) &&
    /\\end\{[a-zA-Z*]+\}\s*$/.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

function looksLikeGraphFenceBody(body: string): boolean {
  return /^\s*(?:flowchart|graph)\s+(?:LR|TB|RL|BT)\b/im.test(body);
}

function firstFenceInfoToken(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function inferLanguageFromCode(
  body: string,
): HighlightCodeLanguageId | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  if (/^#!.*\b(python3?)\b/m.test(trimmed)) return "python";
  if (/^#!.*\b(bash|sh|zsh|dash)\b/m.test(trimmed)) return "bash";
  if (/^#!/m.test(trimmed)) return "bash";

  if (/^[\{\[]/.test(trimmed) && /[\}\]]$/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // fall through
    }
  }

  if (
    /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|TRUNCATE)\b/im.test(
      trimmed,
    )
  ) {
    return "sql";
  }

  if (
    /\b(fn\s+\w+|let\s+mut\b|impl\s+\w+|pub\s+(?:fn|struct|enum|mod)\b|println!\s*\()/.test(
      trimmed,
    )
  ) {
    return "rust";
  }

  if (
    /\b(def\s+\w+\s*\(|async\s+def\s+\w+|class\s+\w+\s*[:\(]|from\s+[\w.]+\s+import\b|import\s+[\w.]+(?:\s+as\s+\w+)?\s*$)/m.test(
      trimmed,
    ) ||
    (/^\s*@\w+/.test(trimmed) && /\bdef\s+\w+/.test(trimmed))
  ) {
    return "python";
  }

  if (
    /\b(interface\s+\w+|type\s+\w+\s*=|:\s*(?:string|number|boolean|void|unknown|never)\b|as\s+const\b|satisfies\s+)/.test(
      trimmed,
    )
  ) {
    return "typescript";
  }

  if (/\b(package\s+\w+|func\s+\w+\s*\(|:=\s*|fmt\.Println)/.test(trimmed)) {
    return "go";
  }

  if (
    /\b(public\s+(?:class|interface|enum)\b|System\.out\.println|void\s+\w+\s*\()/.test(
      trimmed,
    )
  ) {
    return "java";
  }

  if (/#include\s*[<"]/.test(trimmed)) {
    return /\b(?:std::|cout|cin|template\s*<|namespace\s+std)\b/.test(trimmed)
      ? "cpp"
      : "c";
  }

  if (
    /\b(fun\s+\w+|data\s+class\b|val\s+\w+\s*[:=]|companion\s+object\b)/.test(
      trimmed,
    )
  ) {
    return "kotlin";
  }

  if (
    /\b(func\s+\w+|import\s+Foundation\b|var\s+\w+\s*:\s*\w+|guard\s+let\b)/.test(
      trimmed,
    )
  ) {
    return "swift";
  }

  if (
    /\b(def\s+\w+|puts\s+|require\s+['"])/.test(trimmed) &&
    /\bend\b/.test(trimmed)
  ) {
    return "ruby";
  }

  if (/<\?php|\becho\s+/.test(trimmed)) return "php";

  if (
    /[.#]?[\w-]+\s*\{[^}]*:[^}]+;/.test(trimmed) &&
    !/<\/?[a-zA-Z]/.test(trimmed)
  ) {
    return "css";
  }

  if (/<\/?[a-zA-Z][\w:-]*(?:\s|>|\/)/.test(trimmed)) return "xml";

  if (
    /\b(const|let|var|function|=>|console\.log|export\s+(?:default|const|function|class|async)|require\s*\(|module\.exports)\b/.test(
      trimmed,
    )
  ) {
    return "javascript";
  }

  if (
    /^\s*(?:echo|export)\s+\w+/m.test(trimmed) ||
    /^\s*if\s+\[\s/.test(trimmed) ||
    /^\s*\$\w+/m.test(trimmed)
  ) {
    return "bash";
  }

  // YAML: key: value lines without JS/JSON punctuation density.
  if (
    /^[\w"'-]+\s*:\s+\S+/m.test(trimmed) &&
    !/[{;()]/.test(trimmed.slice(0, 240))
  ) {
    return "yaml";
  }

  return undefined;
}

function resolveRepairLanguage(
  body: string,
  options?: RepairCodeFencesOptions,
): HighlightCodeLanguageId | undefined {
  return (
    inferLanguageFromCode(body) ??
    resolveHighlightCodeLanguage(options?.defaultLanguage)
  );
}

function shouldSkipBody(body: string, language: string): boolean {
  if (extractMathLatexFromCodeBody(body)) return true;
  if (isReservedFenceLanguage(language)) return true;
  if (
    language === "mermaid" ||
    language === "flowchart" ||
    language === "graph"
  ) {
    return true;
  }
  if (!language && looksLikeGraphFenceBody(body)) return true;
  return false;
}

function formatMultilineFence(language: string, body: string): string {
  const normalizedBody = formatCollapsedCodeBody(
    language,
    body.replace(/^\n/, "").replace(/\n$/, ""),
  );
  return `\`\`\`${language}\n${normalizedBody}\n\`\`\``;
}

function canonicalizeLanguage(language: string): string {
  return resolveHighlightCodeLanguage(language) ?? language.toLowerCase();
}

/** Only split collapsed openers when the first token is a real/placeholder fence tag. */
function isCollapsedOpenerLanguage(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return false;
  return Boolean(
    resolveHighlightCodeLanguage(normalized) ||
    isReservedFenceLanguage(normalized) ||
    isPlaceholderFenceLanguage(normalized),
  );
}

/**
 * Repair bare / placeholder markdown code fences by inferring a highlight.js
 * language id from the body (optional soft defaultLanguage prior).
 *
 * Also splits collapsed openers (`\`\`\`python def foo` → language + newline).
 * Skips math-disguised and graph fence bodies so later math/graph rewrites still work.
 */
export function repairBareMarkdownCodeFences(
  text: string,
  options?: RepairCodeFencesOptions,
): string {
  if (!text.includes("```")) return text;

  let repaired = text;

  // 1) Collapsed multiline opener: ```python def foo():\n  return 1\n```
  repaired = repaired.replace(
    /```([A-Za-z][\w+#.-]*)[ \t]+([^\n`][^\n]*)\n([\s\S]*?)```/g,
    (match, rawLang: string, firstLine: string, rest: string) => {
      if (!isCollapsedOpenerLanguage(rawLang)) return match;
      const language = rawLang.toLowerCase();
      const body = `${firstLine}\n${rest}`;
      if (shouldSkipBody(body, language)) return match;
      if (shouldKeepFenceLanguage(language)) {
        return formatMultilineFence(canonicalizeLanguage(language), body);
      }
      const inferred = resolveRepairLanguage(body, options);
      if (!inferred) return match;
      return formatMultilineFence(inferred, body);
    },
  );

  // 2) Normal multiline fences: ```info\nbody\n```
  repaired = repaired.replace(
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (match, info: string, body: string) => {
      const language = firstFenceInfoToken(info);
      if (shouldSkipBody(body, language)) return match;
      if (shouldKeepFenceLanguage(language)) {
        // Canonicalize aliases (py → python) when already tagged.
        const canonical = resolveHighlightCodeLanguage(language) ?? language;
        const normalizedBody = body.replace(/^\n/, "").replace(/\n$/, "");
        const formatted = formatCollapsedCodeBody(canonical, normalizedBody);
        if (canonical !== language || formatted !== normalizedBody) {
          return formatMultilineFence(canonical, formatted);
        }
        return match;
      }
      const inferred = resolveRepairLanguage(body, options);
      if (!inferred) return match;
      return formatMultilineFence(inferred, body);
    },
  );

  // 3) Single-line fences: ```body``` or ```python body```
  repaired = repaired.replace(/```([^`\n]+)```/g, (match, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed) return match;

    const collapsed = trimmed.match(/^([A-Za-z][\w+#.-]*)[ \t]+([\s\S]+)$/);
    if (collapsed && isCollapsedOpenerLanguage(collapsed[1]!)) {
      const maybeLang = collapsed[1]!.toLowerCase();
      const rest = collapsed[2] ?? "";
      if (shouldSkipBody(rest, maybeLang)) return match;
      if (shouldKeepFenceLanguage(maybeLang)) {
        return formatMultilineFence(canonicalizeLanguage(maybeLang), rest);
      }
      const inferred = resolveRepairLanguage(rest, options);
      if (inferred) return formatMultilineFence(inferred, rest);
      return match;
    }

    if (shouldSkipBody(trimmed, "")) return match;
    const inferred = resolveRepairLanguage(trimmed, options);
    if (!inferred) return match;
    return formatMultilineFence(inferred, trimmed);
  });

  return repaired;
}
