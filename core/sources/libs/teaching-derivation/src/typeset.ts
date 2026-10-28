import katex from "katex";

export function latexTypesetError(latex: string): string | null {
  try {
    katex.renderToString(latex, {
      throwOnError: true,
      displayMode: true,
      strict: "ignore",
      trust: false,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Animation annotations are disposable; the committed formula is authoritative. */
export function renderTeachingFormulaMarkup(
  annotated: string,
  original: string,
  options: katex.KatexOptions = {},
): string {
  const render = (latex: string) =>
    katex.renderToString(latex, {
      strict: "ignore",
      ...options,
      throwOnError: true,
      trust: (context) => context.command === "\\htmlId",
    });
  try {
    return render(annotated);
  } catch {
    try {
      return render(original);
    } catch {
      return '<span role="img" aria-label="Formula unavailable">—</span>';
    }
  }
}
