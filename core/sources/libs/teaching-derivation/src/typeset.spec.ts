import {renderTeachingFormulaMarkup, spaceTallMathRows} from "./typeset.js";

describe("multi-row teaching formulas", () => {
  it("adds room between consecutive display-sized fractions", () => {
    const latex = String.raw`\begin{cases}\mathbf v_1=\mathbf V+\dfrac{m_2}{M}\mathbf w_b,\\\mathbf v_2=\mathbf V-\dfrac{m_1}{M}\mathbf w_b.\end{cases}`;
    const spaced = String.raw`\begin{cases}\mathbf v_1=\mathbf V+\dfrac{m_2}{M}\mathbf w_b,\\[1em]\mathbf v_2=\mathbf V-\dfrac{m_1}{M}\mathbf w_b.\end{cases}`;
    expect(spaceTallMathRows(latex)).toBe(spaced);
    expect(renderTeachingFormulaMarkup(latex, latex, {displayMode: true})).toContain("katex-display");
  });

  it("respects authored spacing and leaves ordinary or single-line math alone", () => {
    const explicit = String.raw`\begin{cases}\dfrac ab\\[2em]\dfrac cd\end{cases}`;
    const ordinary = String.raw`\begin{cases}a=1\\b=2\end{cases}`;
    const single = String.raw`x=\dfrac ab`;
    expect(spaceTallMathRows(explicit)).toBe(explicit);
    expect(spaceTallMathRows(ordinary)).toBe(ordinary);
    expect(spaceTallMathRows(single)).toBe(single);
  });

  it("adds a smaller buffer for ordinary fractions in multi-row formulas", () => {
    const latex = String.raw`\begin{pmatrix}\frac{123}{456}\\\tfrac{789}{012}\end{pmatrix}`;
    expect(spaceTallMathRows(latex)).toBe(String.raw`\begin{pmatrix}\frac{123}{456}\\[.5em]\tfrac{789}{012}\end{pmatrix}`);
    expect(spaceTallMathRows(String.raw`\begin{cases}\frac{a}{b}\\[.2em]\frac{c}{d}\end{cases}`))
      .toBe(String.raw`\begin{cases}\frac{a}{b}\\[.2em]\frac{c}{d}\end{cases}`);
    expect(spaceTallMathRows(String.raw`\begin{aligned}\frac{a}{b}\\\dfrac{c}{d}\end{aligned}`))
      .toBe(String.raw`\begin{aligned}\frac{a}{b}\\[1em]\dfrac{c}{d}\end{aligned}`);
    expect(spaceTallMathRows(String.raw`\begin{cases}\cfrac{a}{b}\\c\end{cases}`))
      .toBe(String.raw`\begin{cases}\cfrac{a}{b}\\[1em]c\end{cases}`);
  });

  it("pads array rows without rewriting nested braces, escaped symbols or annotations", () => {
    const latex = String.raw`\htmlId{target}{\begin{array}{cc}\dfrac{a}{b}&\text{A}\\c&\text{B}\end{array}}`;
    expect(spaceTallMathRows(latex)).toBe(String.raw`\htmlId{target}{\begin{array}{cc}\dfrac{a}{b}&\text{A}\\[1em]c&\text{B}\end{array}}`);
    expect(renderTeachingFormulaMarkup(latex, latex, {displayMode: true})).toContain('id="target"');
    expect(spaceTallMathRows(String.raw`\begin{cases}\dfrac ab\\c`)).toBe(String.raw`\begin{cases}\dfrac ab\\c`);
  });
});
