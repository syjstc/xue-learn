import type { InteractiveBlock } from "../llm/schemas.js";
import { legacyCompareDisplay } from "../../../domain/src/index.js";
import { escapeHtml } from "./html-text.js";
import {
  renderPdfMarkdownBlock,
  renderPdfMarkdownInline,
} from "./pdf-markdown.js";

const CALLOUT_LABELS = {
  tip: "提示",
  warning: "注意",
  definition: "定义",
  example: "示例",
} as const;

type CheckBlock = Extract<InteractiveBlock, { type: "check" }>;

function collectCheckBlocks(blocks: InteractiveBlock[]): CheckBlock[] {
  return blocks.filter((b): b is CheckBlock => b.type === "check");
}

function renderBlock(block: InteractiveBlock, checkNumber?: number): string {
  switch (block.type) {
    case "heading":
      return block.level === 2
        ? `<div class="mat-h2">${renderPdfMarkdownInline(block.text)}</div>`
        : `<div class="mat-h3">${renderPdfMarkdownInline(block.text)}</div>`;
    case "paragraph":
      return `<div class="mat-p">${renderPdfMarkdownBlock(block.text)}</div>`;
    case "code":
      return `<pre class="mat-code"><code>${escapeHtml(block.code)}</code></pre>`;
    case "conversation":
      return `<div class="callout">
        ${block.title ? `<div class="callout-label">${renderPdfMarkdownInline(block.title)}</div>` : ""}
        ${block.turns
          .map(
            (turn) =>
              `<div class="mat-p"><strong>${escapeHtml(turn.speaker)}:</strong> ${renderPdfMarkdownBlock(turn.text)}</div>`,
          )
          .join("")}
      </div>`;
    case "callout":
      return `<div class="callout callout-${block.variant}">
        <div class="callout-label">${escapeHtml(block.title ?? CALLOUT_LABELS[block.variant])}</div>
        <div class="callout-body">${renderPdfMarkdownBlock(block.body)}</div>
      </div>`;
    case "accordion":
      return `<div>
        <div class="mat-h3">${renderPdfMarkdownInline(block.title)}</div>
        <div class="mat-p">${renderPdfMarkdownBlock(block.body)}</div>
      </div>`;
    case "check": {
      const question =
        checkNumber != null
          ? `${checkNumber}. ${block.question}`
          : block.question;
      const options = block.options
        .map(
          (opt, j) =>
            `<div class="mat-option">${String.fromCharCode(65 + j)}. ${renderPdfMarkdownInline(opt)}</div>`,
        )
        .join("");
      return `<div class="callout callout-check">
        <div class="mat-h3">${renderPdfMarkdownInline(question)}</div>
        ${options}
      </div>`;
    }
    case "compare":
      return renderBlock(legacyCompareDisplay(block).display as InteractiveBlock);
    case "stage":
      return `<div class="material-stage">${block.figures.map((figure) => renderBlock(figure)).join("")}</div>`;
    case "illustration":
      return `<div>
        ${block.imageUrl ? `<img class="illustration" src="${block.imageUrl}" alt="" />` : ""}
        ${block.caption ? `<div class="illustration-caption">${renderPdfMarkdownInline(block.caption)}</div>` : ""}
      </div>`;
    case "svg":
      return `<div>
        ${block.title ? `<div class="mat-h3">${renderPdfMarkdownInline(block.title)}</div>` : ""}
        <div class="illustration" role="img" aria-label="${escapeHtml(block.alt)}">${block.svg}</div>
        <div class="illustration-caption">${renderPdfMarkdownInline(block.caption)}</div>
      </div>`;
    case "interactive_html":
      return `<div>
        <div class="mat-h3">${renderPdfMarkdownInline(block.title)}</div>
        <div class="illustration-caption">${renderPdfMarkdownInline(block.summary)}</div>
      </div>`;
    case "chemistry_lab":
      return `<div>
        <div class="mat-h3">${renderPdfMarkdownInline(block.title)}</div>
        <div class="illustration-caption">${renderPdfMarkdownInline(block.summary)}（交互实验请在 Web/桌面端打开）</div>
      </div>`;
    case "graph":
      return `<div>
        <div class="mat-h3">${renderPdfMarkdownInline(block.title)}</div>
        ${block.nodes.map((node) => `<div class="bullet">• ${renderPdfMarkdownInline(node.label)}${node.description ? ` — ${renderPdfMarkdownInline(node.description)}` : ""}</div>`).join("")}
        ${block.caption ? `<div class="illustration-caption">${renderPdfMarkdownInline(block.caption)}</div>` : ""}
      </div>`;
    default:
      return "";
  }
}

export function renderMaterialBlocksHtml(blocks: InteractiveBlock[]): string {
  let checkNumber = 0;
  return blocks
    .map((block) => {
      const checkIndex = block.type === "check" ? ++checkNumber : undefined;
      const inner = renderBlock(block, checkIndex);
      return inner ? `<div class="mat-block">${inner}</div>` : "";
    })
    .join("");
}

export function renderCheckAnswerKeyHtml(blocks: InteractiveBlock[]): string {
  const checks = collectCheckBlocks(blocks);
  if (checks.length === 0) return "";

  const items = checks
    .map((block, i) => {
      const letter = String.fromCharCode(65 + block.correctIndex);
      const answer = block.options[block.correctIndex];
      return `<div class="answer-item">
        <div class="mat-h3">${i + 1}. ${renderPdfMarkdownInline(block.question)}</div>
        <div class="mat-correct">答案：${letter}. ${renderPdfMarkdownInline(answer)}</div>
        <div class="mat-p">解析：${renderPdfMarkdownBlock(block.explanation)}</div>
      </div>`;
    })
    .join("");

  return `<div class="answer-key">
    <div class="mat-h2">参考答案</div>
    ${items}
  </div>`;
}
