import { readingDerivationSchema, readingPlotSchema } from "../../domain/src/reading-document.js";
import { readingDerivationToTeaching, teachingDerivationToReading } from "./reading.js";
import { compileTeachingDerivation } from "./compile.js";
const compact = {title: "Solve an equation", premises: [{id: "p1", text: "$a\\ne0$"}], steps: [
  {id: "s1", result: "ax=b", reason: "Start with the given equation.", dependsOn: ["p1"]},
  {id: "s2", result: "x=\\frac{b}{a}", reason: "Divide both sides by a.", dependsOn: ["s1", "p1"], condition: "$a\\ne0$"},
]};
it("retains step results and premises while deriving Display transitions in code", () => {
  const document = readingDerivationToTeaching(compact, {id: "equation", locale: "en"});
  const derived = compileTeachingDerivation(document);
  expect(document.steps[1].board[0].source).toEqual({stepIndex: 1, formulaKey: "work"});
  expect(document.steps[1].givenIndexes).toEqual([0]);
  expect(derived.steps[1].transitions).toHaveLength(1);
  expect(teachingDerivationToReading(document).steps[1]).toMatchObject({
    result: compact.steps[1].result, condition: compact.steps[1].condition, dependsOn: expect.arrayContaining(["p1", "s1"]),
  });
});
it("renders undelimited saved premises in Display without modifying the reading source", () => {
  const source = {...compact, premises: [{id: "p1", text: "已知 C_1=200 J/K，T_1=60 °C。"}]};
  const before = JSON.stringify(source);
  const teaching = readingDerivationToTeaching(source, {id: "knowns", locale: "zh-Hans"});
  expect(teaching.givens).toEqual([String.raw`已知 $C_1=200\,\mathrm{J/K}$，$T_1=60\,{}^{\circ}\mathrm{C}$。`]);
  expect(JSON.stringify(source)).toBe(before);
  expect(compileTeachingDerivation(teaching).steps).toHaveLength(2);
});
it("rejects circular, forward or missing premise dependencies", () => {
  for (const dependency of ["s2", "missing"]) {
    const parsed = readingDerivationSchema.safeParse({...compact, steps: [{...compact.steps[0], dependsOn: [dependency]}]});
    expect(parsed.success).toBe(false);
  }
});
it("rejects executable plot expressions and conflicting parameters", () => {
  const plot = {title: "Plot", functions: [{expression: "a*x^2", label: "Parabola"}], xRange: [-3, 3], yRange: [-1, 9],
    parameters: [{id: "a", name: "a", min: -2, max: 2, step: 0.1, default: 1}], caption: "Change a."};
  expect(readingPlotSchema.safeParse(plot).success).toBe(true);
  expect(readingPlotSchema.safeParse({...plot, functions: [{expression: "globalThis.process.exit()", label: "Bad"}]}).success).toBe(false);
  expect(readingPlotSchema.safeParse({...plot, parameters: [{...plot.parameters[0], id: "x"}]}).success).toBe(false);
  expect(readingPlotSchema.safeParse({...plot, parameters: [{...plot.parameters[0], id: "A"}]}).success).toBe(false);
  expect(readingPlotSchema.safeParse({...plot, parameters: [{...plot.parameters[0], id: "pi"}]}).success).toBe(false);
});
