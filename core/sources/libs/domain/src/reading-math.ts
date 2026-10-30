/** Presentation-only recovery for previously saved reading formulas. */
export function normalizeReadingLatex(latex: string): string {
  // TeX environments own real \\ row separators; never rewrite those.
  if (/\\(?:begin|end|substack|subarray)\s*\{|\\verb/.test(latex)) return latex.trim();
  return latex.trim().replace(
    /(?<!\\)\\\\(?=(?:Delta|delta|alpha|beta|gamma|theta|lambda|sigma|mu|pi|mathrm|mathbf|mathit|mathbb|text|frac|sqrt|times|cdot|approx|ne|neq|leq|geq|lim|to|infty|sum|int|left|right|quad|qquad)\b|[,;!])/g,
    "\\",
  );
}

export type ReadingResultPart = {kind: "math" | "text"; value: string};
export function readingResultParts(result: string): ReadingResultPart[] {
  const source = result.trim().replace(/^```(?:math|latex|tex)\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();
  const parts: ReadingResultPart[] = [];
  const spans = /\$\$([\s\S]+?)\$\$|(?<!\\)\$([^\n$]+?)\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
  let offset = 0;
  for (const match of source.matchAll(spans)) {
    const before = source.slice(offset, match.index).trim();
    if (before) parts.push({kind: "text", value: before});
    parts.push({kind: "math", value: normalizeReadingLatex(match[1] ?? match[2] ?? match[3] ?? match[4])});
    offset = match.index! + match[0].length;
  }
  if (!parts.length) return [{kind: "math", value: normalizeReadingLatex(source)}];
  const after = source.slice(offset).trim();
  if (after) parts.push({kind: "text", value: after});
  return parts;
}

/** Never wrap already-delimited math (or its adjacent explanation) in another $$ pair. */
export function readingResultMarkdown(result: string): string {
  return readingResultParts(result).map(part => part.kind === "math"
    ? `$$\n${part.value}\n$$` : part.value).join("\n\n");
}

/** Clean only explicit math spans; code examples and ordinary prose stay intact. */
export function readingProseMarkdown(source: string): string {
  return source.replace(
    /```[\s\S]*?```|`[^`\n]*`|\$\$([\s\S]+?)\$\$|(?<!\\)\$([^\n$]+?)\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g,
    (match, display?: string, inline?: string, bracket?: string, paren?: string) => {
      if (match.startsWith("`")) return match;
      if (display !== undefined || bracket !== undefined) return `$$\n${normalizeReadingLatex(display ?? bracket!)}\n$$`;
      return `$${normalizeReadingLatex(inline ?? paren!)}$`;
    },
  );
}

const premiseGreek = "\\u0370-\\u03ff∆";
const premiseSubscript = String.raw`(?:[_^](?:\{[A-Za-z0-9,+\-]+\}|[A-Za-z0-9]+))*`;
const premiseVariable = String.raw`(?:\\(?:Delta|delta|alpha|beta|gamma|theta|lambda|sigma|mu|pi|rho|omega|Omega)[ \t]*[A-Za-z]{0,2}|[A-Za-z]{1,2}(?:[${premiseGreek}][A-Za-z]{0,2})*|[${premiseGreek}][A-Za-z]{0,2})${premiseSubscript}`;
const premiseNumber = String.raw`(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+\-]?\d+)?`;
const premiseAtom = String.raw`[+\-−]?(?:${premiseVariable}|${premiseNumber})`;
const premiseOperator = String.raw`(?:[=+\-−*/·×<>≤≥≠≈±]|\\(?:ne|neq|le|leq|ge|geq|approx|times|cdot)\b)`;
const premiseExpression = String.raw`${premiseAtom}(?:[ \t]*${premiseOperator}[ \t]*${premiseAtom})*`;
const premiseUnitAtom = String.raw`(?:°[ \t]*C|℃|kJ|J|K|kW|W|Pa|Hz|N|V|A|mol|kg|mg|g|km|cm|mm|m|ms|s|mL|L)(?:\^\{?[+\-]?\d+\}?)?`;
const premiseUnit = String.raw`${premiseUnitAtom}(?:[ \t]*[·/*][ \t]*${premiseUnitAtom})*`;

function premiseUnitLatex(unit: string): string {
  if (/^(?:°\s*C|℃)$/.test(unit)) return String.raw`{}^{\circ}\mathrm{C}`;
  return `\\mathrm{${unit.replace(/\s/g, "").replaceAll("·", String.raw`\cdot `)}}`;
}

/** Recover clear mathematical notation only in saved premise prose. Neither
 * learner content nor ordinary prose/code is rewritten in storage. */
export function readingPremiseMarkdown(source: string): string {
  const normalized = readingProseMarkdown(source);
  const recover = (text: string) => text.replace(new RegExp(
    String.raw`(?<![A-Za-z0-9_\\./:])(?<formula>${premiseExpression})(?:[ \t]*(?<unit>${premiseUnit}))?(?![A-Za-z0-9_])`, "g",
  ), (...args) => {
    const {formula, unit} = args.at(-1) as {formula: string; unit?: string};
    const unitOnly = new RegExp(`^(?:${premiseUnit})$`).test(formula) && /[/·^]/.test(formula);
    if (!unit && !unitOnly && !/[_^\\=<>≤≥≠≈\u0370-\u03ff∆]/.test(formula)) return args[0];
    const latex = unitOnly ? premiseUnitLatex(formula) : normalizeReadingLatex(formula)
      .replace(/[Δ∆]/g, String.raw`\Delta `).replace(/δ/g, String.raw`\delta `)
      .replace(/−/g, "-").replace(/×/g, String.raw`\times `).replace(/·/g, String.raw`\cdot `)
      .replace(/≤/g, String.raw`\le `).replace(/≥/g, String.raw`\ge `)
      .replace(/≠/g, String.raw`\ne `).replace(/≈/g, String.raw`\approx `).replace(/±/g, String.raw`\pm `);
    return `$${latex}${unit ? `\\,${premiseUnitLatex(unit)}` : ""}$`;
  });
  // Explicit math, code, links and URLs retain their authored boundaries.
  const protectedSpans = /```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]+?\$\$|(?<!\\)\$[^\n$]+?\$|!?\[[^\]\n]*\]\([^\n)]*\)|https?:\/\/[^\s<>]+/g;
  let result = "", offset = 0;
  for (const match of normalized.matchAll(protectedSpans)) {
    result += recover(normalized.slice(offset, match.index)) + match[0];
    offset = match.index! + match[0].length;
  }
  return result + recover(normalized.slice(offset));
}
