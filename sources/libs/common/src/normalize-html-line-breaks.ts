import { repairCollapsedMarkdownTables } from "./repair-collapsed-markdown-tables.js";

/**
 * Decode legacy literal newlines in prose, never inside math or code. A global
 * replacement corrupts LaTeX commands such as \\ne, \\nu and \\nabla. Already
 * decoded fences keep their source escapes; collapsed legacy fences still
 * pass through newline decoding before the Markdown parser sees them.
 */
export function normalizeEscapedMarkdownNewlines(text: string): string {
  return text.replace(
    /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|(?<!`)(`{1,2})(?!`)[^`\n]*?\2(?!`)|\$\$[\s\S]*?\$\$|\$(?:\\[^\n]|[^$\n\\])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\\\|\\\$|\\n/g,
    (token) => (token === "\\n" ? "\n" : token),
  );
}

function replaceHtmlTagPair(
  text: string,
  tag: string,
  open: string,
  close: string,
): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  return text.replace(pattern, (_, inner: string) => `${open}${inner}${close}`);
}

/** Replace lone opening/closing tags when the model mixed HTML with markdown emphasis. */
function replaceLoneHtmlTags(text: string, tag: string, marker: string): string {
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi");
  const close = new RegExp(`</${tag}>`, "gi");
  return text.replace(open, marker).replace(close, marker);
}

function collapseRedundantEmphasis(text: string): string {
  // LLMs often mix markdown ** with <b>, yielding ****** — never valid emphasis.
  return text.replace(/\*{4,}/g, "**");
}

/**
 * Convert literal HTML tags (common in LLM output) to markdown equivalents.
 * Handles line breaks and inline emphasis so ReactMarkdown renders them instead
 * of showing raw tags in lesson content.
 */
export function normalizeHtmlLineBreaks(text: string): string {
  let out = text.replace(/<br\s*\/?>/gi, "  \n");

  for (const tag of ["strong", "b"]) {
    out = replaceHtmlTagPair(out, tag, "**", "**");
    out = replaceLoneHtmlTags(out, tag, "**");
  }
  for (const tag of ["em", "i"]) {
    out = replaceHtmlTagPair(out, tag, "*", "*");
    out = replaceLoneHtmlTags(out, tag, "*");
  }
  for (const tag of ["u", "span"]) {
    out = replaceHtmlTagPair(out, tag, "", "");
    out = replaceLoneHtmlTags(out, tag, "");
  }
  for (const tag of ["ruby", "rt", "rp"]) {
    out = replaceLoneHtmlTags(out, tag, "");
  }

  return repairCollapsedMarkdownTables(collapseRedundantEmphasis(out));
}
