import katex from "katex";
import "katex/contrib/mhchem";
import { KATEX_MACROS } from "./katex-macros.js";
import { sanitizeLatexMathBody } from "./normalize-latex-math.js";

export const KATEX_RENDER_OPTIONS = {
  throwOnError: false,
  strict: "ignore" as const,
  macros: KATEX_MACROS,
};

export function renderKatexHtml(latex: string, display: boolean): string {
  return katex.renderToString(sanitizeLatexMathBody(latex.trim()), {
    ...KATEX_RENDER_OPTIONS,
    displayMode: display,
  });
}
