const LATEX_COMMAND_RE = /\\[a-zA-Z]+/;
const MHCHEM_UNIT_RE = /\\pu([0-9][0-9a-zA-Z.^/°\-]*)/g;
const MHCHEM_BARE_PU_RE = /\\pu\{([^}]+)\}/g;
const MHCHEM_BARE_CE_RE = /\\ce\{([^}]+)\}/g;
const MHCHEM_MARKDOWN_GAP_RE = /(?:\*\*)?(?:\s|\*{1,2})*/;

function formatMhchemUnit(inner: string): string {
  return inner.replace(/^([0-9.]+)([a-zA-Z/])/, "$1 $2");
}

function normalizePuUnitContent(unit: string): string {
  return formatMhchemUnit(unit.trim());
}

function fixMhchemLatex(latex: string): string {
  return latex.replace(MHCHEM_UNIT_RE, (_, inner: string) =>
    `\\pu{${formatMhchemUnit(inner)}}`,
  );
}

/**
 * Single-letter controls KaTeX accepts without treating them as errors.
 * Accents that take `{...}` are preserved separately when `{` follows.
 */
const KATEX_SINGLE_LETTER_COMMANDS = new Set([
  "H",
  "N",
  "P",
  "R",
  "S",
  "Z",
  "c",
  "u",
  "v",
]);

/**
 * LLMs sometimes write `\B` when they mean the variable `B`
 * (e.g. `\|A\|\|\B\|` instead of `\|A\|\|B\|`). KaTeX then paints a red
 * literal backslash. Drop the backslash for unknown one-letter controls;
 * keep real KaTeX one-letter commands, multi-letter commands (`\cos`),
 * braced accent forms (`\c{c}`), and `\\` row breaks (`\\a_{21}`).
 */
function fixAccidentalSingleLetterCommands(latex: string): string {
  return latex.replace(
    /(^|[^\\])\\([A-Za-z])(?![A-Za-z])/g,
    (match, prefix: string, letter: string, offset: number, source: string) => {
      if (KATEX_SINGLE_LETTER_COMMANDS.has(letter)) return match;
      if (source[offset + match.length] === "{") return match;
      return `${prefix}${letter}`;
    },
  );
}

/** Recover observed double-escaped controls in standalone math, not TeX rows. */
function fixStandaloneEscapedCommands(latex: string): string {
  // Any environment can own row separators. Braced groups can too (substack,
  // gathered arguments), or contain literal text; leave these and \verb intact.
  if (/\\(?:begin|end)\s*\{|\\verb\*?(?![A-Za-z])/.test(latex)) return latex;
  let depth = 0;
  return latex.replace(
    /\\(?:\\(?:to|longrightarrow)(?![A-Za-z])|\\frac(?=\d{2}(?![\dA-Za-z]))|[^\s])|[{}]/g,
    (token, offset: number) => {
      if (token === "{") depth++;
      if (token === "}") depth = Math.max(0, depth - 1);
      // Unknown commands and ordinary \\ row breaks are not candidates.
      return depth === 0 &&
        latex[offset - 1] !== "\\" &&
        token.startsWith("\\\\") &&
        token.length > 2
        ? token.slice(1)
        : token;
    },
  );
}

/** Sanitize a math body before KaTeX / delimiter-normalized markdown render. */
export function sanitizeLatexMathBody(latex: string): string {
  // Persisted course formulas may contain invisible ASCII controls (notably
  // U+007F after "F:"). KaTeX rejects these; keep math whitespace and TeX
  // escapes/row breaks intact. Only math bodies pass through this cleanup.
  const printable = latex.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    "",
  );
  // Recover only known controls fused to ONE variable in legacy saved math.
  // Longer unknown commands, valid controls and row breaks stay untouched.
  // In particular, \neq / \leqq / \geqq are complete control words.
  const separated = fixStandaloneEscapedCommands(printable).replace(
    /(?<!\\)\\(mid|leq|geq|ne|neq|approx|sim|Delta|int|quad|qquad)([A-Za-z])(?![A-Za-z])/g,
    (match, command: string, symbol: string) =>
      ["neq", "leqq", "geqq"].includes(command + symbol) ? match : `\\${command} ${symbol}`,
  );
  const grouped = separated.replace(
    /(?<!\\)\\(mathbb|mathbf|mathcal|mathfrak|mathrm|mathit|mathsf|mathtt|mathscr|widehat|bar)([A-Za-z])(?![A-Za-z])/g,
    "\\$1{$2}",
  );
  // The saved numeric-list artifact `0.04,\{}0.25` is an empty escaped
  // group, not a set delimiter. Preserve real \{ / \} and nonnumeric copy.
  const lists = grouped.replace(
    /([,;]|(?<!\\)\\(?:to|longrightarrow)(?![A-Za-z]))\\\{\}(?=\s*[+-]?\d)/g,
    "$1\\,",
  );
  return fixAccidentalSingleLetterCommands(fixMhchemLatex(lists));
}

function rewriteDollarMathBodies(
  text: string,
  rewrite: (latex: string) => string,
): string {
  return text.replace(
    /\$\$([\s\S]+?)\$\$|\$([^\n$]+)\$/g,
    (match, display?: string, inline?: string) => {
      if (typeof display === "string") return `$$${rewrite(display)}$$`;
      if (typeof inline === "string") return `$${rewrite(inline)}$`;
      return match;
    },
  );
}

/** LLMs often split \\pu and the unit into adjacent math spans — merge them. */
function mergeSplitMhchemCommands(text: string): string {
  let merged = text;

  merged = merged.replace(
    new RegExp(
      String.raw`\$\\pu(?:\{\})?\$` +
        MHCHEM_MARKDOWN_GAP_RE.source +
        String.raw`\$([^\n$]+?)\$`,
      "g",
    ),
    (_, unit: string) => `$\\pu{${normalizePuUnitContent(unit)}}$`,
  );
  merged = merged.replace(
    new RegExp(
      String.raw`\$\\ce(?:\{\})?\$` +
        MHCHEM_MARKDOWN_GAP_RE.source +
        String.raw`\$([^\n$]+?)\$`,
      "g",
    ),
    (_, formula: string) => `$\\ce{${formula.trim()}}$`,
  );
  merged = merged.replace(
    new RegExp(
      String.raw`\\pu` + MHCHEM_MARKDOWN_GAP_RE.source + String.raw`\$([^\n$]+?)\$`,
      "g",
    ),
    (_, unit: string) => `$\\pu{${normalizePuUnitContent(unit)}}$`,
  );
  merged = merged.replace(
    new RegExp(
      String.raw`\\ce` + MHCHEM_MARKDOWN_GAP_RE.source + String.raw`\$([^\n$]+?)\$`,
      "g",
    ),
    (_, formula: string) => `$\\ce{${formula.trim()}}$`,
  );

  return merged
    .replace(/\*{1,2}\s*(?=\$\\pu\{)/g, "")
    .replace(/\*{1,2}\s*(?=\$\\ce\{)/g, "")
    .replace(/\$\\pu(?:\{\})?\$(?!\s*\$)/g, "");
}

function wrapBareMhchemCommands(text: string): string {
  return text
    .replace(MHCHEM_BARE_PU_RE, (_, inner: string) => `$\\pu{${inner}}$`)
    .replace(MHCHEM_UNIT_RE, (_, inner: string) =>
      `$\\pu{${formatMhchemUnit(inner)}}$`,
    )
    .replace(MHCHEM_BARE_CE_RE, (_, inner: string) => `$\\ce{${inner}}$`);
}

function normalizeMhchemMarkup(text: string): string {
  let normalized = mergeSplitMhchemCommands(text);

  const mathTokens: string[] = [];
  normalized = protectDollarMath(normalized, mathTokens);

  for (let index = 0; index < mathTokens.length; index++) {
    const token = mathTokens[index] ?? "";
    if (token.startsWith("$$")) {
      mathTokens[index] = `$$${fixMhchemLatex(token.slice(2, -2))}$$`;
      continue;
    }
    if (token.startsWith("$")) {
      mathTokens[index] = `$${fixMhchemLatex(token.slice(1, -1))}$`;
    }
  }

  normalized = wrapBareMhchemCommands(normalized);
  return restoreDollarMath(normalized, mathTokens);
}

function protectCodeSpans(text: string): {
  text: string;
  restore: (value: string) => string;
} {
  const blocks: string[] = [];
  const protectedText = text.replace(
    /```[\s\S]*?```|`[^`\n]*(?:\n[^`]*)?`/g,
    (block) => {
      const token = `__LATEX_MATH_CODE_${blocks.length}__`;
      blocks.push(block);
      return token;
    },
  );

  return {
    text: protectedText,
    restore: (value) =>
      value.replace(
        /__LATEX_MATH_CODE_(\d+)__/g,
        (_, index: string) => blocks[Number(index)] ?? "",
      ),
  };
}

function looksLikeLatex(content: string): boolean {
  return LATEX_COMMAND_RE.test(content);
}

/**
 * LLMs sometimes put display math in a code span/fence with a literal `math`
 * prefix (or a bare `\\begin{...}` body) instead of a ```math info string.
 * Rewrite those into dollar delimiters before markdown parsing.
 */
function extractMathLatexFromCodeBody(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const prefixed = trimmed.match(/^math(?:\s+|\s*\n+)([\s\S]+)$/i);
  if (prefixed) {
    const latex = prefixed[1]?.trim() ?? "";
    return looksLikeLatex(latex) ? latex : null;
  }

  if (
    /^\\begin\{[a-zA-Z*]+\}/.test(trimmed) &&
    /\\end\{[a-zA-Z*]+\}\s*$/.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

function rewriteMathDisguisedAsCode(text: string): string {
  // Single-line ```math … ``` mid-paragraph (common LLM mistake). Must run
  // before the single-backtick pass: otherwise one inner `…` pair becomes
  // $$…$$ and leftover backticks wrap the math as code again (``$$…$$``).
  let rewritten = text.replace(
    /```(math|latex|tex)[ \t]+([\s\S]*?)```/gi,
    (match, _lang: string, body: string) => {
      const latex = body.trim();
      if (!latex) return match;
      return `$$\n${latex}\n$$`;
    },
  );

  // Unlabeled / math-disguised multiline fences (opener ends with a newline).
  // Proper ```math\n…\n``` fences are left for the markdown code renderer.
  rewritten = rewritten.replace(
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (match, info: string, body: string) => {
      const language =
        String(info)
          .trim()
          .split(/\s+/)[0]
          ?.toLowerCase() ?? "";
      if (
        language === "math" ||
        language === "latex" ||
        language === "tex"
      ) {
        return match;
      }
      if (language) return match;
      const latex = extractMathLatexFromCodeBody(body);
      if (!latex) return match;
      return `$$\n${latex}\n$$`;
    },
  );

  // Unlabeled single-line fences: ``` \begin{…}\end{…} ``` or ``` math … ```.
  rewritten = rewritten.replace(/```([^`\n]+)```/g, (match, body: string) => {
    const latex = extractMathLatexFromCodeBody(body);
    if (!latex) return match;
    return `$$\n${latex}\n$$`;
  });

  rewritten = rewritten.replace(/`([^`\n]+)`/g, (match, body: string) => {
    const latex = extractMathLatexFromCodeBody(body);
    if (!latex) return match;
    if (/\\begin\{/.test(latex) || latex.length > 60) {
      return `$$\n${latex}\n$$`;
    }
    return `$${latex}$`;
  });

  return rewritten;
}

function protectDollarMath(text: string, tokens: string[]): string {
  return text.replace(/\$\$[\s\S]+?\$\$|\$[^\n$]+\$/g, (match) => {
    const token = `__LATEX_MATH_DOLLAR_${tokens.length}__`;
    tokens.push(match);
    return token;
  });
}

function restoreDollarMath(text: string, tokens: string[]): string {
  return text.replace(
    /__LATEX_MATH_DOLLAR_(\d+)__/g,
    (_, index: string) => tokens[Number(index)] ?? "",
  );
}

/**
 * LLMs often close a number as `$12$` and then leave a stray `$` after the
 * unit (`$12$ ℃$`). remark-math consumes the first pair, so the board shows
 * a leftover dollar. Drop those unpaired trailers after protecting real math.
 * Keep `$100` / `$variable` openers and escaped `\$`.
 */
function stripOrphanMathDollars(text: string): string {
  const tokens: string[] = [];
  const protectedText = protectDollarMath(text, tokens);
  return restoreDollarMath(
    protectedText.replace(/([^\s$\\])\\?\$(?!\d)/g, "$1"),
    tokens,
  );
}

/**
 * Normalize LaTeX delimiters for markdown + remark-math.
 *
 * CommonMark treats `\(` / `\)` as escaped parentheses, so LLM output like
 * `\(\psi_1\)` becomes literal `(\psi_1)`. Convert to `$...$` / `$$...$$`
 * before react-markdown parses the string.
 *
 * Also repairs already-corrupted output where backslashes were eaten but LaTeX
 * commands remain inside `(...)` or `[...]`, and rewrites `math …` code
 * spans/fences (including single-line mid-paragraph ```math … ```) into real
 * math delimiters. A stray closing `$` after a finished `$…$` span (or after
 * prose like `12 ℃$`) is dropped so it does not render as a lone dollar.
 */
export function normalizeLatexMathDelimiters(text: string): string {
  const { text: protectedText, restore } = protectCodeSpans(
    rewriteMathDisguisedAsCode(text),
  );
  let normalized = protectedText;

  normalized = normalized.replace(
    /\\\[([\s\S]+?)\\\]/g,
    (_, latex: string) => `$$${latex}$$`,
  );
  normalized = normalized.replace(
    /\\\(([\s\S]+?)\\\)/g,
    (_, latex: string) => `$${latex}$`,
  );

  const mathTokens: string[] = [];
  normalized = protectDollarMath(normalized, mathTokens);

  normalized = normalized.replace(
    /\[([^\[\]]+)\]/g,
    (match, inner: string) =>
      looksLikeLatex(inner) ? `$$${inner}$$` : match,
  );
  normalized = protectDollarMath(normalized, mathTokens);

  normalized = normalized.replace(
    /\(([^()]+)\)/g,
    (match, inner: string) =>
      looksLikeLatex(inner) ? `$${inner}$` : match,
  );

  normalized = restoreDollarMath(normalized, mathTokens);

  normalized = normalizeMhchemMarkup(normalized);
  normalized = rewriteDollarMathBodies(normalized, sanitizeLatexMathBody);
  normalized = stripOrphanMathDollars(normalized);

  return restore(normalized);
}
