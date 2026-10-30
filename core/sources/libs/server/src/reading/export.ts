import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type { ReadingDocument, ReadingComponentArtifact, ReadingPlot } from "../../../domain/src/reading-document.js";
import {readingPremiseMarkdown, readingProseMarkdown, readingResultMarkdown} from "../../../domain/src/reading-math.js";
import { compileMathExpression } from "../../../domain/src/math-scene.js";
import { renderPdfMarkdownBlock } from "../export/pdf-markdown.js";
import { pdfFontFaceCss, pdfKatexCss } from "../export/pdf-fonts-html.js";
import { readRawUnitImage } from "../images/storage.js";
import { assertCourseSvgRenderable } from "../llm/safe-svg.js";
import { normalizeLatexMathDelimiters } from "../markdown/normalize-latex-math.js";

export type ReadingPdfLayout = "mobile" | "desktop";
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const prose = (value: string) => {
  const formulas: string[] = [];
  const text = normalizeLatexMathDelimiters(readingProseMarkdown(value)).replace(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+\$/g, match => {
    formulas.push(match); return `READINGMATHPLACEHOLDER${formulas.length - 1}END`;
  });
  return renderPdfMarkdownBlock(escape(text).replace(/READINGMATHPLACEHOLDER(\d+)END/g, (_, index) => formulas[Number(index)]));
};
const svgImage = (svg: string) => `<img alt="" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`;

/** Samples the same safe expressions and defaults used by the interactive graph. */
export function readingPlotSvg(plot: ReadingPlot): string {
  const left = 48, top = 20, width = 564, height = 300;
  const [xmin, xmax] = plot.xRange, [ymin, ymax] = plot.yRange;
  const x = (value: number) => left + (value - xmin) * width / (xmax - xmin);
  const y = (value: number) => top + height - (value - ymin) * height / (ymax - ymin);
  const parameters = Object.fromEntries(plot.parameters.map(p => [p.id.toLowerCase(), p.default]));
  const colors = ["#2563eb", "#be123c", "#047857", "#7c3aed", "#b45309", "#0e7490"];
  const paths = plot.functions.map((fn, index) => {
    const evaluate = compileMathExpression(fn.expression, ["x", ...Object.keys(parameters)]);
    let d = "", previous: number | null = null;
    for (let i = 0; i <= 720; i++) {
      const xv = xmin + (xmax - xmin) * i / 720, yv = evaluate({...parameters, x: xv});
      if (!Number.isFinite(yv) || yv < ymin || yv > ymax) { previous = null; continue; }
      const py = y(yv);
      d += `${previous === null || Math.abs(py - previous) > height / 2 ? "M" : "L"}${x(xv).toFixed(2)},${py.toFixed(2)} `;
      previous = py;
    }
    return `<path d="${d}" fill="none" stroke="${colors[index]}" stroke-width="2.5"/>`;
  }).join("");
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const xv = xmin + (xmax - xmin) * i / 4, yv = ymin + (ymax - ymin) * i / 4;
    grid += `<path d="M${x(xv)},${top}v${height} M${left},${y(yv)}h${width}" stroke="#e2e8f0"/>
      <text x="${x(xv)}" y="343" text-anchor="middle">${Number(xv.toPrecision(4))}</text>
      <text x="42" y="${y(yv) + 4}" text-anchor="end">${Number(yv.toPrecision(4))}</text>`;
  }
  const axes = `${xmin <= 0 && xmax >= 0 ? `M${x(0)},${top}v${height}` : ""}
    ${ymin <= 0 && ymax >= 0 ? `M${left},${y(0)}h${width}` : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="white"/><g font-family="sans-serif" font-size="12" fill="#475569">${grid}</g>
    <path d="${axes}" stroke="#64748b"/>${paths}</svg>`;
}

function componentHtml(artifact: ReadingComponentArtifact, prefix: string, english: boolean): string {
  switch (artifact.type) {
    case "svg":
      assertCourseSvgRenderable(artifact.svg);
      return `<figure>${svgImage(artifact.svg)}<figcaption>${prose(artifact.caption)}</figcaption></figure>`;
    case "image":
      return `<figure>${/^data:image\/(?:png|jpeg|webp);base64,/.test(artifact.imageUrl)
        ? `<img src="${escape(artifact.imageUrl)}" alt="${escape(artifact.caption)}">`
        : `<p>${english ? "Image unavailable in this export." : "本次导出未能载入图片。"}</p>`}
        <figcaption>${prose(artifact.caption)}</figcaption></figure>`;
    case "plot": {
      const plot = artifact.plot;
      return `<figure><h3>${escape(plot.title)}</h3>${svgImage(readingPlotSvg(plot))}
        ${prose(plot.functions.map(fn => fn.label + ": `" + fn.expression + "`").join("\n\n"))}
        ${plot.parameters.length ? `<p class="muted">${escape(plot.parameters.map(p => `${p.name} = ${p.default}`).join(", "))}</p>` : ""}
        <figcaption>${prose(plot.caption)}</figcaption></figure>`;
    }
    case "derivation": {
      const document = artifact.document;
      const label = (id: string) => {
        const premise = document.premises.findIndex(p => p.id === id);
        return premise >= 0 ? `${english ? "Premise" : "前提"} ${premise + 1}`
          : `${english ? "Step" : "步骤"} ${document.steps.findIndex(s => s.id === id) + 1}`;
      };
      return `<section><h3>${escape(document.title)}</h3>
        ${document.premises.length ? `<h4>${english ? "Premises" : "已知条件"}</h4><ol>${document.premises.map(p =>
          `<li id="${prefix}-${p.id}">${prose(readingPremiseMarkdown(p.text))}</li>`).join("")}</ol>` : ""}
        <ol class="steps">${document.steps.map(step => `<li id="${prefix}-${step.id}">
          <div class="formula">${prose(readingResultMarkdown(step.result))}</div>${prose(step.reason)}
          ${step.condition ? `<aside>${prose(step.condition)}</aside>` : ""}
          ${step.dependsOn.length ? `<p class="muted">${english ? "Based on" : "依据"}：
            ${step.dependsOn.map(id => `<a href="#${prefix}-${id}">${label(id)}</a>`).join(" · ")}</p>` : ""}
        </li>`).join("")}</ol></section>`;
    }
  }
}

function fontCss(): string {
  // Desktop stages these assets next to the service; source hosts can resolve
  // the normal installed package. Font URLs are inlined for offline rendering.
  let directory = path.join(process.cwd(), "reading-pdf/katex");
  if (!fs.existsSync(path.join(directory, "katex.min.css"))) {
    try {directory = path.dirname(createRequire(path.join(process.cwd(), "package.json")).resolve("katex/dist/katex.min.css"));}
    catch {directory = path.join(process.cwd(), "node_modules/katex/dist");}
  }
  const katex = fs.existsSync(path.join(directory, "katex.min.css"))
    ? fs.readFileSync(path.join(directory, "katex.min.css"), "utf8") : pdfKatexCss();
  return `${pdfFontFaceCss()}\n${katex}`.replace(/url\((['"]?)([^)'"]+)\1\)/g, (_, _quote, url: string) => {
    if (url.startsWith("data:")) return `url("${url}")`;
    try {
      const filename = url.startsWith("file:") ? fileURLToPath(url)
        : path.resolve(directory, url);
      const extension = path.extname(filename).slice(1);
      return `url("data:font/${extension};base64,${fs.readFileSync(filename).toString("base64")}")`;
    } catch { return "url(data:application/octet-stream;base64,)"; }
  });
}

/** A snapshot: expanded explanations, answer keys and explicit pending slots. */
export function buildReadingHtml(document: ReadingDocument, options: {layout?: ReadingPdfLayout; language?: string} = {}): string {
  const english = options.language?.startsWith("en") ?? false;
  const blocks = document.blocks.map(block => {
    switch (block.type) {
      case "heading": return `<h2>${escape(block.text)}</h2>`;
      case "paragraph": return prose(block.text);
      case "callout": return `<aside class="callout ${block.variant}"><h3>${escape(block.title)}</h3>${prose(block.body)}</aside>`;
      case "accordion": return `<aside><h3>${escape(block.title)}</h3>${prose(block.body)}</aside>`;
      case "steps": return `<section><h3>${escape(block.title)}</h3><ol class="steps">${block.items.map(item =>
        `<li><h4>${escape(item.title)}</h4>${prose(item.body)}</li>`).join("")}</ol></section>`;
      case "comparison": return `<section><h3>${escape(block.title)}</h3><div class="comparison">${block.items.map(item =>
        `<aside><h4>${escape(item.title)}</h4>${prose(item.body)}</aside>`).join("")}</div></section>`;
      case "concept_grid": return `<section><h3>${escape(block.title)}</h3><dl class="concepts">${block.items.map(item =>
        `<div><dt>${escape(item.term)}</dt><dd>${prose(item.definition)}</dd></div>`).join("")}</dl></section>`;
      case "summary": return `<aside class="summary"><h3>${escape(block.title)}</h3><ul>${block.items.map(item =>
        `<li>${prose(item)}</li>`).join("")}</ul></aside>`;
      case "check": return `<section class="check"><h3>${english ? "Self-check" : "随堂自测"}</h3>${prose(block.question)}
        <ol type="A">${block.options.map(option => `<li>${prose(option)}</li>`).join("")}</ol>
        <div class="answer"><strong>${english ? "Answer" : "答案"}：${String.fromCharCode(65 + block.correctIndex)}</strong>${prose(block.explanation)}</div></section>`;
      case "component_slot": return block.component?.status === "ready" && block.component.artifact
        ? componentHtml(block.component.artifact, block.id, english)
        : `<aside class="placeholder"><h3>${escape(block.title)}</h3>
          <p>${english ? "This component was not ready at export time." : "导出时此组件尚未就绪。"}</p>${prose(block.description)}</aside>`;
    }
  }).join("\n");
  return `<!doctype html><html lang="${english ? "en" : "zh"}"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
    <title>${escape(document.title)}</title><style>${fontCss()}
    *{box-sizing:border-box}body{font-family:NotoSansSC,"PingFang SC",sans-serif;color:#243244;margin:0;font-size:${options.layout === "mobile" ? "13px" : "15px"};line-height:1.8;overflow-wrap:anywhere}
    h1{font-size:1.9em;line-height:1.4;margin:0 0 1em}h2{font-size:1.4em;margin:1.8em 0 .6em}h3{font-size:1.15em;margin:.2em 0 .6em}
    h1,h2,h3,h4{break-after:avoid}p{orphans:3;widows:3}aside,.check{padding:14px;border:1px solid #dbe3eb;border-radius:8px;margin:18px 0;background:#f8fafc}
    figure{margin:20px 0;break-inside:avoid}img{max-width:100%;max-height:420px;object-fit:contain;display:block;margin:auto}
    figcaption,.muted{font-size:.9em;color:#52657a}.steps{padding-left:24px}.steps>li{border-bottom:1px solid #e2e8f0;padding:14px 0;break-inside:avoid}
    .answer{border-top:1px solid #dbe3eb;padding-top:12px}.placeholder{border-style:dashed}.katex-display{max-width:100%;white-space:normal;text-align:left;margin:10px 0}
    .katex{font-size:1.05em}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px}
    a{color:#1d4ed8}ol,ul{padding-left:24px}li>.md-block>p{margin:.3em 0}
    .callout{padding:0;border:0;border-radius:0;background:none}
    .formula{font-size:1.15em;padding:12px;background:#f8fafc;border-radius:8px}
    .comparison{display:grid;grid-template-columns:${options.layout === "mobile" ? "1fr" : "repeat(2,minmax(0,1fr))"};gap:12px}.comparison>aside{margin:8px 0;break-inside:avoid}
    .concepts>div{border-bottom:1px solid #dbe3eb;padding:12px 0;break-inside:avoid}.concepts dt{font-weight:700}.concepts dd{margin:6px 0}.summary{background:#f1f7f4}
    </style></head><body><h1>${escape(document.title)}</h1>${blocks}</body></html>`;
}

export async function prepareReadingHtml(unitId: string, document: ReadingDocument,
  options: {layout?: ReadingPdfLayout; language?: string} = {}): Promise<string> {
  const blocks = await Promise.all(document.blocks.map(async block => {
    const artifact = block.component?.artifact;
    if (artifact?.type !== "image") return block;
    const match = /^\/api\/units\/([^/]+)\/images\/(ill-[^.]+)\.(png|jpg|webp)(?:\?.*)?$/.exec(artifact.imageUrl);
    if (!match || decodeURIComponent(match[1]) !== unitId) return block;
    const file = await readRawUnitImage(unitId, match[2]);
    return file ? {...block, component: {...block.component!, artifact: {...artifact,
      imageUrl: `data:${file.mimeType};base64,${file.data.toString("base64")}`}}} : block;
  }));
  return buildReadingHtml({...document, blocks}, {...options, layout: options.layout ?? "mobile"});
}
