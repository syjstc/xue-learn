import path from "path";
import { pathToFileURL } from "url";
import fs from "fs";

const FONT_DIR = path.join(
  process.cwd(),
  "node_modules/@fontsource/noto-sans-sc/files",
);

function fontUrl(filename: string): string {
  return pathToFileURL(path.join(FONT_DIR, filename)).href;
}

/** CSS @font-face rules for Noto Sans SC (local files, no network fetch). */
export function pdfFontFaceCss(): string {
  return `
@font-face {
  font-family: "NotoSansSC";
  font-weight: 400;
  font-style: normal;
  src: url("${fontUrl("noto-sans-sc-chinese-simplified-400-normal.woff")}") format("woff");
}
@font-face {
  font-family: "NotoSansSC";
  font-weight: 700;
  font-style: normal;
  src: url("${fontUrl("noto-sans-sc-chinese-simplified-700-normal.woff")}") format("woff");
}
`.trim();
}

export const PDF_FONT_FAMILY = "NotoSansSC, sans-serif";

export function pdfKatexCss(): string {
  try {
    return fs.readFileSync(
      path.join(process.cwd(), "node_modules/katex/dist/katex.min.css"),
      "utf8",
    );
  } catch {
    return "";
  }
}
