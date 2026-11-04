import katex from "katex";

const ROW_ENVIRONMENTS = new Set([
  "cases", "dcases", "rcases", "array", "aligned", "alignedat", "gathered",
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "split",
]);

/**
 * TeX's default array struts do not always grow for fractions. In a multi-row
 * expression this can draw a denominator on top of the next row's numerator.
 * Give display-sized fractions more space and ordinary fractions a smaller
 * buffer; preserve author-specified spacing and the mathematical expression.
 */
export function spaceTallMathRows(latex: string): string {
  type Frame = { name: string; depth: number; tall: boolean; fraction: boolean; breaks: number[] };
  const stack: Frame[] = [], complete: Frame[] = [];
  let depth = 0;
  for (let i = 0; i < latex.length;) {
    if (latex[i] === "\\") {
      const environment = /^\\(begin|end)\{([A-Za-z*]+)\}/.exec(latex.slice(i));
      if (environment) {
        const [, direction, name] = environment;
        if (direction === "begin") stack.push({ name, depth, tall: false, fraction: false, breaks: [] });
        else {
          const frame = stack.pop();
          if (!frame || frame.name !== name || frame.depth !== depth) return latex;
          complete.push(frame);
        }
        i += environment[0].length;
        continue;
      }
      if (latex[i + 1] === "\\") {
        const frame = stack.at(-1);
        let after = i + 2;
        if (latex[after] === "*") after++;
        let following = after;
        while (/\s/.test(latex[following] ?? "")) following++;
        if (frame && ROW_ENVIRONMENTS.has(frame.name) && frame.depth === depth
          && latex[following] !== "[" && !latex.startsWith("\\end{", following)) {
          frame.breaks.push(after);
        }
        i = after;
        continue;
      }
      const command = /^\\([A-Za-z]+)/.exec(latex.slice(i));
      if (command) {
        if (command[1] === "dfrac" || command[1] === "cfrac" || command[1] === "displaystyle") {
          for (const frame of stack) if (ROW_ENVIRONMENTS.has(frame.name)) frame.tall = true;
        } else if (command[1] === "frac" || command[1] === "tfrac") {
          for (const frame of stack) if (ROW_ENVIRONMENTS.has(frame.name)) frame.fraction = true;
        }
        i += command[0].length;
        continue;
      }
      i += Math.min(2, latex.length - i); // escaped brace or other symbol
      continue;
    }
    if (latex[i] === "{") depth++;
    else if (latex[i] === "}") { depth--; if (depth < 0) return latex; }
    i++;
  }
  if (stack.length || depth !== 0) return latex;
  const spacings = new Map<number, string>();
  for (const frame of complete) {
    if (!frame.tall && !frame.fraction) continue;
    for (const position of frame.breaks) {
      if (frame.tall || !spacings.has(position)) spacings.set(position, frame.tall ? "1em" : ".5em");
    }
  }
  const insertions = [...spacings.keys()].sort((a, b) => b - a);
  let result = latex;
  for (const position of insertions) result = `${result.slice(0, position)}[${spacings.get(position)}]${result.slice(position)}`;
  return result;
}

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
    katex.renderToString(spaceTallMathRows(latex), {
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
