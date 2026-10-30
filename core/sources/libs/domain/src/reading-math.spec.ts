import katex from "katex";
import {normalizeReadingLatex, readingPremiseMarkdown, readingProseMarkdown, readingResultMarkdown, readingResultParts} from "./reading-math.js";

it("renders the saved double-escaped, dollar-wrapped result without nesting delimiters or losing its explanation", () => {
  const result = String.raw`$\\Delta T_1=T_{\\mathrm f}-T_1=T_{\\mathrm f}-60\\,\\mathrm{K}$（末态减初态，带符号）`;
  const parts = readingResultParts(result);
  expect(parts).toEqual([
    {kind: "math", value: String.raw`\Delta T_1=T_{\mathrm f}-T_1=T_{\mathrm f}-60\,\mathrm{K}`},
    {kind: "text", value: "（末态减初态，带符号）"},
  ]);
  expect(katex.renderToString(parts[0].value, {throwOnError: true})).toContain("katex");
  expect(readingResultMarkdown(result)).not.toContain("$$$");
});

it("keeps separate formulas and accompanying prose, and accepts bare or bracket-delimited LaTeX", () => {
  expect(readingResultParts("$Q=0$，$W>0$，所以内能增加。").map(part => part.kind))
    .toEqual(["math", "text", "math", "text"]);
  for (const source of ["x=-b/a", "$x=-b/a$", "$$x=-b/a$$", String.raw`\[x=-b/a\]`])
    expect(readingResultParts(source)).toEqual([{kind: "math", value: "x=-b/a"}]);
});

it("preserves real matrix row breaks and code while cleaning explicit prose math", () => {
  const matrix = String.raw`\begin{matrix}a&b\\c&d\end{matrix}`;
  expect(normalizeReadingLatex(matrix)).toBe(matrix);
  expect(katex.renderToString(matrix, {throwOnError: true})).toContain("mtable");
  const code = String.raw`code: ` + "`" + String.raw`$\\Delta$` + "`";
  expect(readingProseMarkdown(code)).toBe(code);
  expect(readingProseMarkdown(String.raw`温差 $\\Delta T=5\\,\\mathrm{K}$。`))
    .toBe(String.raw`温差 $\Delta T=5\,\mathrm{K}$。`);
});

it("recovers the saved heat-capacity data as inline math with subscripts and upright units", () => {
  const source = "已知数据（教学设定）：C_1=200 J/K，T_1=60 °C；C_2=400 J/K，T_2=20 °C；两物体热容量均非零且为正。";
  const recovered = readingPremiseMarkdown(source);
  expect(recovered).toBe(String.raw`已知数据（教学设定）：$C_1=200\,\mathrm{J/K}$，$T_1=60\,{}^{\circ}\mathrm{C}$；$C_2=400\,\mathrm{J/K}$，$T_2=20\,{}^{\circ}\mathrm{C}$；两物体热容量均非零且为正。`);
  for (const part of readingResultParts(recovered).filter(part => part.kind === "math"))
    expect(katex.renderToString(part.value, {throwOnError: true})).toContain("katex");
  expect(readingPremiseMarkdown(recovered)).toBe(recovered);
});

it("recovers bare energy balances and variables without turning the explanation into a formula", () => {
  expect(readingPremiseMarkdown("无外界做功，故整体内能收支为 ΔU_1+ΔU_2=0，且各自 ΔU=CΔT。"))
    .toBe(String.raw`无外界做功，故整体内能收支为 $\Delta U_1+\Delta U_2=0$，且各自 $\Delta U=C\Delta T$。`);
  expect(readingPremiseMarkdown("热容量 C_1 > 0，温度 T_f 待定，温差 20 K；单位 J/K。"))
    .toBe(String.raw`热容量 $C_1 > 0$，温度 $T_f$ 待定，温差 $20\,\mathrm{K}$；单位 $\mathrm{J/K}$。`);
});

it("preserves authored math, code, links, ordinary text and dates in premise recovery", () => {
  const source = String.raw`模型说明 reading_job_1，chapter_2；2026/10/20，1.0.2，200 元。已知 $C_1=200\,\mathrm{J/K}$，参见 [C_1](https://example.com/C_1) 和 https://example.com/T_1。代码 ` + "`C_1=200`\n```text\nT_1=60 °C\n```";
  expect(readingPremiseMarkdown(source)).toBe(source);
  expect(readingProseMarkdown("普通正文 T_1=60 °C。")).toBe("普通正文 T_1=60 °C。");
});
