import type {
  GoalTextbook,
  TextbookLessonSection,
  TextbookModuleSection,
} from "./goal-textbook-model.js";
import {
  renderCheckAnswerKeyHtml,
  renderMaterialBlocksHtml,
} from "./html-material-blocks.js";
import { escapeHtml } from "./html-text.js";
import {
  renderPdfMarkdownBlock,
  renderPdfMarkdownInline,
} from "./pdf-markdown.js";
import { PDF_FONT_FAMILY, pdfFontFaceCss, pdfKatexCss } from "./pdf-fonts-html.js";
import { sectionAnchorId } from "./section-anchor.js";
import type { GoalTextbookPdfLayout } from "./pdf-layout.js";

const LEVEL_LABELS: Record<string, string> = {
  zero: "零基础",
  basic: "有基础",
  advanced: "进阶",
};

function pdfStyles(layout: GoalTextbookPdfLayout): string {
  const mobileStyles =
    layout === "mobile"
      ? `
body {
  font-size: 9.5pt;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.cover-page {
  min-height: 760px;
  padding: 28px 20px 24px;
  margin: -20px;
}
.cover-panel { padding: 22px 18px; }
.cover-title { font-size: 21pt; }
.cover-stat-row { flex-direction: column; }
.toc-page { padding: 16px 14px; }
.toc-heading { font-size: 18pt; }
.toc-entry::before,
.toc-entry::after { content: ""; display: none; }
.toc-entry { display: block; }
.toc-lesson { padding-left: 10px; }
.module-card { padding: 13px 14px; }
.chapter-title { font-size: 14pt; }
.lesson-title { font-size: 13pt; padding-left: 10px; }
.subtitle { font-size: 11pt; }
.compare-row { display: block; }
.compare-col { margin-bottom: 8px; }
.md-block table {
  display: block;
  overflow-wrap: anywhere;
  table-layout: fixed;
}
.md-block th, .md-block td { padding: 4px 5px; }
.illustration { max-height: 220px; }
`
      : "";

  return `
${pdfFontFaceCss()}
${pdfKatexCss()}

* { box-sizing: border-box; }

body {
  font-family: ${PDF_FONT_FAMILY};
  font-size: 10.25pt;
  line-height: 1.58;
  color: #263449;
  margin: 0;
  background: #ffffff;
}

/* Title hierarchy */
.cover-title { font-size: 27pt; font-weight: 800; color: #102033; margin: 0 0 14px; line-height: 1.22; letter-spacing: 0; }
.toc-heading { font-size: 21pt; font-weight: 800; color: #12345b; margin: 0 0 20px; }
.chapter-title { font-size: 17pt; font-weight: 800; color: #f8fafc; margin: 0 0 6px; line-height: 1.28; letter-spacing: 0; }
.lesson-title {
  font-size: 15pt;
  font-weight: 800;
  color: #11243a;
  margin: 0 0 14px;
  line-height: 1.32;
  padding: 0 0 8px 14px;
  border-bottom: 2px solid #bfdbfe;
  border-left: 5px solid #0ea5e9;
}
.subtitle {
  font-size: 12pt;
  font-weight: 800;
  color: #0f3b66;
  margin: 16px 0 8px;
  padding-left: 10px;
  border-left: 4px solid #f59e0b;
}

.cover-meta { font-size: 10pt; color: #506179; margin: 0 0 6px; }
.cover-overview { font-size: 11pt; line-height: 1.65; color: #334155; margin-top: 16px; }
.body { font-size: 10.25pt; line-height: 1.6; color: #263449; margin: 0 0 5px; }
.bullet { font-size: 10.25pt; margin: 0 0 5px 14px; color: #3f5067; line-height: 1.55; }
.bullet strong, .mat-p strong, .mat-option strong { font-weight: 700; color: #0f172a; }
.bullet em { font-style: italic; }
.pronunciation-ruby {
  ruby-align: center;
  ruby-position: over;
  margin-inline: 0.02em;
  line-height: 1.85;
  text-align: center;
  white-space: nowrap;
}
.pronunciation-ruby rt {
  color: #64748b;
  font-size: 0.5em;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: 0;
}
.bullet code, .mat-p code, .mat-option code {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 3px;
}
.placeholder { font-size: 10pt; color: #94a3b8; margin: 6px 0; }

.cover-page {
  min-height: 960px;
  padding: 54px 48px 42px;
  margin: -48px;
  background:
    linear-gradient(135deg, rgba(14, 165, 233, 0.16), rgba(245, 158, 11, 0.08) 48%, rgba(16, 185, 129, 0.11)),
    #f8fbff;
}
.cover-panel {
  border-top: 8px solid #0ea5e9;
  background: rgba(255, 255, 255, 0.86);
  border-radius: 8px;
  padding: 30px 34px;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
}
.cover-kicker {
  display: inline-block;
  font-size: 8.5pt;
  font-weight: 800;
  color: #075985;
  background: #e0f2fe;
  border: 1px solid #bae6fd;
  border-radius: 999px;
  padding: 4px 10px;
  margin-bottom: 16px;
}
.aigc-notice {
  display: inline-block;
  margin-top: 16px;
  padding: 5px 10px;
  border: 1px solid #93c5fd;
  border-radius: 999px;
  background: #eff6ff;
  color: #1e3a8a;
  font-size: 9pt;
  font-weight: 800;
}
.cover-stat-row { display: flex; gap: 8px; margin: 18px 0 4px; }
.cover-stat {
  flex: 1;
  border: 1px solid #c7d2fe;
  border-radius: 7px;
  padding: 9px 10px;
  background: #ffffff;
}
.cover-stat-value { font-size: 15pt; font-weight: 800; color: #1d4ed8; line-height: 1.1; }
.cover-stat-label { font-size: 8.2pt; color: #64748b; margin-top: 2px; }

/* Table of contents — dot leaders + page numbers + internal links */
.toc-page {
  padding: 22px;
  background: #ffffff;
  border: 1px solid #dbeafe;
  border-radius: 8px;
}
.toc { margin-top: 8px; }
.toc-entry {
  display: flex;
  align-items: baseline;
  text-decoration: none;
  color: #334155;
  margin-bottom: 8px;
  line-height: 1.4;
}
.toc-label { flex: 0 1 auto; }
.toc-entry::before {
  content: leader(".");
  flex: 1 1 auto;
  margin: 0 6px;
  order: 1;
}
.toc-entry::after {
  content: target-counter(attr(href url), page);
  flex: 0 0 auto;
  order: 2;
}
.toc-module { font-size: 11pt; font-weight: 800; color: #0f3b66; margin-top: 10px; }
.toc-lesson { font-size: 10pt; font-weight: 400; padding-left: 18px; color: #3f5067; }

.cornell-box {
  border: 1px solid #99f6e4;
  border-radius: 8px;
  padding: 12px 14px;
  margin-top: 8px;
  background: transparent;
  break-inside: avoid;
}
.intro-box {
  background: transparent;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 10px;
  break-inside: avoid;
}

.module-card {
  margin: 0 0 18px;
  padding: 16px 18px;
  border-radius: 8px;
  background: linear-gradient(135deg, #164e63, #1d4ed8);
  color: #f8fafc;
  break-inside: avoid;
}
.module-card .body, .module-card .md-block { color: #dbeafe; }
.module-card .md-block strong, .module-card .md-strong { color: #ffffff; }
.mat-block { margin-bottom: 10px; break-inside: avoid; }
.mat-h2 {
  font-size: 13pt; font-weight: 800; color: #102033;
  margin: 12px 0 7px; padding-bottom: 5px;
  border-bottom: 2px solid #bae6fd;
}
.mat-h3 { font-size: 11pt; font-weight: 800; color: #1e293b; margin: 7px 0 5px; }
.mat-p { font-size: 10.25pt; line-height: 1.6; color: #263449; margin: 0 0 7px; }
.mat-code { margin: 0 0 9px; padding: 9px 11px; overflow-x: auto; border: 1px solid #d8dee9; border-radius: 6px; background: #f4f6f8; color: #1f2937; font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 8.75pt; line-height: 1.5; white-space: pre; }
.callout {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px 12px;
  margin: 8px 0;
  background: transparent;
  break-inside: avoid;
  box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
}
.callout-tip { border-color: #86efac; }
.callout-warning { border-color: #fbbf24; }
.callout-definition { border-color: #93c5fd; }
.callout-example { border-color: #c4b5fd; }
.callout-check {
  border-color: #7dd3fc;
  background: transparent;
  border-left: 5px solid #0ea5e9;
}
.callout-label {
  font-size: 8.2pt; font-weight: 800; color: #0f3b66;
  margin-bottom: 4px;
}
.callout-body { font-size: 10.25pt; line-height: 1.55; color: #263449; }
.mat-option { font-size: 9.6pt; color: #3f5067; margin: 0 0 4px 12px; line-height: 1.48; }
.mat-correct { font-size: 9.4pt; color: #047857; margin-top: 4px; font-weight: 700; }
.step-item { margin-bottom: 8px; break-inside: avoid; }
.compare-row { display: flex; gap: 8px; }
.compare-col {
  flex: 1;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  padding: 9px 10px;
  background: transparent;
  break-inside: avoid;
}
.compare-col:nth-child(2) {
  border-color: #c4b5fd;
}
.illustration { display: block; width: 100%; max-height: 280px; object-fit: contain; margin: 6px 0 4px; }
.illustration-caption { font-size: 9pt; color: #64748b; margin-top: 2px; }
.answer-key { margin-top: 12px; }
.answer-item {
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  background: transparent;
  break-inside: avoid;
}

/* Markdown (marked output) */
.md-block { font-size: 10.25pt; line-height: 1.6; color: #263449; }
.md-block > :first-child { margin-top: 0; }
.md-block > :last-child { margin-bottom: 0; }
.md-block p { margin: 0 0 7px; }
.md-block ul, .md-block ol { margin: 0 0 7px 18px; padding: 0; }
.md-block li { margin-bottom: 3px; }
.md-block strong, .md-strong { font-weight: 700; color: #0f172a; }
.md-block em, .md-em { font-style: italic; }
.md-block code {
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 3px;
}
.md-block pre {
  background: #102033;
  color: #f8fafc;
  padding: 10px;
  border-radius: 7px;
  overflow-x: auto;
  font-size: 9pt;
  margin: 8px 0;
}
.md-block pre code { background: none; padding: 0; color: inherit; }
.md-block blockquote {
  border-left: 4px solid #38bdf8;
  margin: 8px 0;
  padding: 4px 0 4px 11px;
  color: #3f5067;
  background: #f0f9ff;
}
.md-block table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 9pt; }
.md-block th, .md-block td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; }
.md-block th { background: #e0f2fe; font-weight: 800; color: #0f3b66; }
.md-block .md-h2 { font-size: 11.2pt; font-weight: 800; margin: 8px 0 5px; color: #12345b; }
.md-block .md-h3 { font-size: 10.3pt; font-weight: 800; margin: 5px 0 4px; color: #1e293b; }
.md-block hr { border: none; border-top: 1px solid #e2e8f0; margin: 8px 0; }

.page-break { page-break-after: always; break-after: page; }
.lesson-page {
  page-break-before: always;
  break-before: page;
  background: transparent;
}
${mobileStyles}
`.trim();
}

function renderCoverPage(book: GoalTextbook): string {
  const { goal, mapPlan, stats } = book;
  const overview =
    goal.topicOverview ||
    mapPlan?.topicOverview ||
    "（暂无主题概述，请在学习计划中完善。）";

  const learnItems = mapPlan
    ? mapPlan.whatYouWillLearn
        .map(
          (item) =>
            `<div class="bullet">• ${renderPdfMarkdownInline(item)}</div>`,
        )
        .join("")
    : "";

  const mapSection = mapPlan
    ? `<div class="subtitle">学习目标</div>${learnItems}`
    : "";

  return `<section class="page-break cover-page">
    <div class="cover-panel">
      <div class="cover-kicker">XueLearn 教材导出</div>
      <p class="cover-title">${escapeHtml(goal.title)}</p>
      <p class="cover-meta">水平：${LEVEL_LABELS[goal.level] ?? escapeHtml(goal.level)} · 导出日期：${new Date().toLocaleDateString("zh-CN")}</p>
      <div class="cover-stat-row">
        <div class="cover-stat"><div class="cover-stat-value">${stats.moduleCount}</div><div class="cover-stat-label">模块</div></div>
        <div class="cover-stat"><div class="cover-stat-value">${stats.lessonCount}</div><div class="cover-stat-label">课时</div></div>
        <div class="cover-stat"><div class="cover-stat-value">${stats.lessonsWithMaterial}/${stats.lessonCount}</div><div class="cover-stat-label">已生成教材</div></div>
      </div>
      <div class="subtitle" style="margin-top:22px">主题概述</div>
      <div class="cover-overview">${renderPdfMarkdownBlock(overview)}</div>
      ${mapSection}
      <div class="aigc-notice">部分内容由 AI 生成，仅供辅助学习</div>
    </div>
  </section>`;
}

function renderTocPage(book: GoalTextbook): string {
  const entries: string[] = [];

  for (const section of book.sections) {
    const anchor = sectionAnchorId(section);
    if (section.kind === "module") {
      entries.push(
        `<a class="toc-entry toc-module" href="#${anchor}"><span class="toc-label">${escapeHtml(section.index)} · ${escapeHtml(section.title)}</span></a>`,
      );
    } else {
      entries.push(
        `<a class="toc-entry toc-lesson" href="#${anchor}"><span class="toc-label">${escapeHtml(section.index)} ${escapeHtml(section.title)}</span></a>`,
      );
    }
  }

  return `<section class="page-break toc-page">
    <p class="toc-heading">目录</p>
    <nav class="toc">${entries.join("")}</nav>
  </section>`;
}

function renderLessonContent(lesson: TextbookLessonSection): string {
  const parts: string[] = [];

  if (lesson.contentSummary) {
    parts.push(
      `<div class="body" style="color:#64748b;margin-bottom:10px">${renderPdfMarkdownBlock(lesson.contentSummary)}</div>`,
    );
  }

  if (lesson.sq) {
    const outline = lesson.sq.survey.outline
      .map(
        (line) =>
          `<div class="bullet">• ${renderPdfMarkdownInline(line)}</div>`,
      )
      .join("");
    const learningTargetLabels = lesson.sq.survey.learningTargetLabels
      .map(
        (line) =>
          `<div class="bullet">• ${renderPdfMarkdownInline(line)}</div>`,
      )
      .join("");
    const questions = lesson.sq.questions
      .map((q, i) => {
        const text = typeof q === "string" ? q : q.text;
        return `<div class="bullet">${i + 1}. ${renderPdfMarkdownInline(text)}</div>`;
      })
      .join("");

    parts.push(`<div>
      <div class="subtitle">预习（SQ）</div>
      <p class="body">概览大纲</p>
      ${outline}
      <p class="body" style="margin-top:8px">关键要点</p>
      ${learningTargetLabels}
      <p class="body" style="margin-top:8px">引导问题</p>
      ${questions}
    </div>`);
  }

  if (lesson.material) {
    const intro = lesson.material.introduction
      ? `<div class="intro-box">${renderPdfMarkdownBlock(lesson.material.introduction)}</div>`
      : "";

    parts.push(`<div>
      <div class="subtitle">学习材料</div>
      ${intro}
      ${renderMaterialBlocksHtml(lesson.material.blocks)}
      ${renderCheckAnswerKeyHtml(lesson.material.blocks)}
    </div>`);
  } else {
    parts.push(`<p class="placeholder">（该课时尚未生成学习材料）</p>`);
  }

  if (lesson.cornell) {
    parts.push(`<div>
      <div class="subtitle">学习笔记</div>
      <div class="cornell-box">
        <p class="body" style="font-weight:700">回忆提示</p>
        <div class="body">${renderPdfMarkdownBlock(lesson.cornell.cues)}</div>
        <p class="body" style="font-weight:700;margin-top:8px">笔记</p>
        <div class="body">${renderPdfMarkdownBlock(lesson.cornell.notes)}</div>
        <p class="body" style="font-weight:700;margin-top:8px">总结</p>
        <div class="body">${renderPdfMarkdownBlock(lesson.cornell.summary)}</div>
      </div>
    </div>`);
  }

  return parts.join("");
}

function renderModuleHeader(module: TextbookModuleSection): string {
  const summary = module.contentSummary
    ? `<div class="body">${renderPdfMarkdownBlock(module.contentSummary)}</div>`
    : "";
  return `<div id="${sectionAnchorId(module)}" class="module-card">
    <h1 class="chapter-title">${escapeHtml(module.index)} · ${escapeHtml(module.title)}</h1>
    ${summary}
  </div>`;
}

function renderContentPages(book: GoalTextbook): string {
  const pages: string[] = [];
  let pendingModule: TextbookModuleSection | null = null;

  for (const section of book.sections) {
    if (section.kind === "module") {
      pendingModule = section;
      continue;
    }

    const lesson = section as TextbookLessonSection;
    const moduleForPage = pendingModule;
    pendingModule = null;
    const anchorId = sectionAnchorId(section);

    pages.push(`<section class="lesson-page" id="${anchorId}">
      ${moduleForPage ? renderModuleHeader(moduleForPage) : ""}
      <h2 class="lesson-title">${escapeHtml(lesson.index)} ${escapeHtml(lesson.title)}</h2>
      ${renderLessonContent(lesson)}
    </section>`);
  }

  return pages.join("");
}

export function buildGoalTextbookHtml(
  book: GoalTextbook,
  options: { layout?: GoalTextbookPdfLayout } = {},
): string {
  const title = escapeHtml(book.goal.title);
  const layout = options.layout ?? "desktop";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>${pdfStyles(layout)}</style>
</head>
<body>
  ${renderCoverPage(book)}
  ${renderTocPage(book)}
  ${renderContentPages(book)}
</body>
</html>`;
}
