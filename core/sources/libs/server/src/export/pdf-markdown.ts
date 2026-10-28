import { marked } from "marked";
import {
  normalizeEscapedMarkdownNewlines,
  normalizeHtmlLineBreaks,
} from "../../../common/src/index.js";
import { stripCitationMarkersForPdf } from "./html-text.js";
import { renderPronunciationHtml } from "./pdf-pronunciation.js";
import { normalizeLatexMathDelimiters } from "../markdown/normalize-latex-math.js";
import { renderKatexHtml } from "../markdown/katex-setup.js";

marked.setOptions({
  gfm: true,
  breaks: false,
});

const inlineRenderer = new marked.Renderer();
inlineRenderer.paragraph = ({ text }) => text;
inlineRenderer.list = (token) =>
  token.items.map((item) => item.text).join(" ");
inlineRenderer.listitem = ({ text }) => `${text} `;
inlineRenderer.link = ({ text }) => text;
inlineRenderer.heading = ({ text }) => `<strong class="md-strong">${text}</strong>`;

const blockRenderer = new marked.Renderer();
blockRenderer.heading = ({ text, depth }) => {
  const cls = depth <= 2 ? "md-h2" : "md-h3";
  return `<div class="${cls}">${text}</div>`;
};

function parseEscapedMarkdownNewlines(text: string): string {
  return normalizeEscapedMarkdownNewlines(text);
}

function renderMathLatex(latex: string, display: boolean): string {
  try {
    return renderKatexHtml(latex, display);
  } catch {
    return latex;
  }
}

function protectCodeSpans(text: string): {
  text: string;
  restore: (value: string) => string;
} {
  const blocks: string[] = [];
  const protectedText = text.replace(
    /```[\s\S]*?```|`[^`\n]*(?:\n[^`]*)?`/g,
    (block) => {
      const token = `__PDF_MARKDOWN_CODE_${blocks.length}__`;
      blocks.push(block);
      return token;
    },
  );

  return {
    text: protectedText,
    restore: (value) =>
      value.replace(
        /__PDF_MARKDOWN_CODE_(\d+)__/g,
        (_, index: string) => blocks[Number(index)] ?? "",
      ),
  };
}

function renderMarkdownMath(text: string): string {
  const { text: protectedText, restore } = protectCodeSpans(text);
  const withBlockMath = protectedText.replace(
    /\$\$([\s\S]+?)\$\$/g,
    (_, latex: string) =>
      `<div class="katex-display">${renderMathLatex(latex, true)}</div>`,
  );
  const withInlineMath = withBlockMath.replace(
    /(^|[^\\$])\$([^\n$]+?)\$/g,
    (_, prefix: string, latex: string) =>
      `${prefix}<span class="katex-inline">${renderMathLatex(latex, false)}</span>`,
  );
  return restore(withInlineMath);
}

function preparePdfMarkdown(text: string): string {
  return renderMarkdownMath(
    normalizeLatexMathDelimiters(
      normalizeHtmlLineBreaks(
        parseEscapedMarkdownNewlines(stripCitationMarkersForPdf(text).trim()),
      ),
    ),
  );
}

/** Inline markdown for titles, bullets, and short strings. */
export function renderPdfMarkdownInline(text: string): string {
  const cleaned = preparePdfMarkdown(text);
  if (!cleaned) return "";
  const html = marked.parseInline(cleaned, { renderer: inlineRenderer }) as string;
  return renderPronunciationHtml(html);
}

/** Block markdown for paragraphs, notes, and multi-line content. */
export function renderPdfMarkdownBlock(text: string): string {
  const cleaned = preparePdfMarkdown(text);
  if (!cleaned) return "";
  const html = marked.parse(cleaned, { renderer: blockRenderer }) as string;
  return `<div class="md-block">${renderPronunciationHtml(html)}</div>`;
}
