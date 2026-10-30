import { readingDerivationSchema, type ReadingDerivation } from "../../domain/src/reading-document.js";
import type { TeachingDerivationDocumentV1 } from "./types.js";
import { readingPremiseMarkdown, readingResultParts } from "../../domain/src/reading-math.js";

/** The same mathematical steps feed the textbook and the existing formula renderer.
 * Whole-formula targets are a conservative baseline, never a claim of algebra verification. */
export function readingDerivationToTeaching(
  source: ReadingDerivation,
  options: { id: string; locale: string },
): TeachingDerivationDocumentV1 {
  const document = readingDerivationSchema.parse(source);
  const results = document.steps.map(step => readingResultParts(step.result));
  const formula = (index: number) => results[index].filter(part => part.kind === "math").map(part => part.value).join("\\qquad ");
  return {
    schemaVersion: 1, id: options.id, title: document.title, locale: options.locale,
    teachingGoal: document.title, givens: document.premises.map(p => readingPremiseMarkdown(p.text)),
    status: "complete", revision: 1,
    steps: document.steps.map((step, offset) => {
      const previous = document.steps[offset - 1];
      const transforms = Boolean(previous && step.dependsOn.includes(previous.id) && step.relation !== "introduce");
      const targets = [
        ...(transforms ? [{id: "before", formulaKey: "work", state: "before" as const, latex: formula(offset - 1)}] : []),
        {id: "after", formulaKey: "work", state: "after" as const, latex: formula(offset)},
      ];
      return {
        index: offset + 1,
        board: [{key: "work", title: document.title, latex: formula(offset), role: "primary" as const,
          change: transforms ? "transform" as const : "introduce" as const,
          ...(transforms ? {source: {stepIndex: offset, formulaKey: "work"}} : {})}],
        relation: transforms ? step.relation ?? "imply" : "introduce",
        justification: [...results[offset].filter(part => part.kind === "text").map(part => part.value), step.reason].join("\n\n"),
        narration: step.reason, conditions: step.condition,
        focusFormulaKey: "work",
        givenIndexes: document.premises.flatMap((p, index) => step.dependsOn.includes(p.id) ? [index] : []),
        references: step.dependsOn.flatMap(dependency => {
          const index = document.steps.findIndex(s => s.id === dependency);
          return index >= 0 ? [{stepIndex: index + 1, formulaKey: "work"}] : [];
        }),
        targets,
        cues: [{id: "explanation", text: step.reason, onScreenText: step.reason.slice(0, 160),
          targetIds: ["after"], ...(transforms ? {startTransform: true} : {})}],
      };
    }),
  };
}

export function teachingDerivationToReading(source: TeachingDerivationDocumentV1): ReadingDerivation {
  const premises = source.givens.map((text, index) => ({id: `p${index + 1}`, text}));
  return {
    title: source.title, premises,
    steps: source.steps.map((step, index) => ({
      id: `s${index + 1}`,
      result: (step.board.some(f => f.role === "primary") ? step.board.filter(f => f.role === "primary") : step.board)
        .map(f => f.latex).join("\\qquad ") || "\\text{—}",
      reason: step.justification || step.narration,
      relation: step.relation === "equivalence" || step.relation === "imply" || step.relation === "substitute"
        ? step.relation : "introduce",
      dependsOn: [...new Set([
        ...(step.givenIndexes ?? []).flatMap(i => premises[i] ? [premises[i].id] : []),
        ...[...(step.references ?? []), ...step.board.flatMap(f => f.source ? [f.source] : [])]
          .filter(ref => ref.stepIndex > 0 && ref.stepIndex <= index).map(ref => `s${ref.stepIndex}`),
      ])],
      ...(step.conditions ? {condition: step.conditions} : {}),
    })),
  };
}
