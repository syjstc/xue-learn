import { compileTeachingPresentation, TEACHING_PRESENTATION_VERSION, teachingPresentationHash } from "./teaching-plan.js";
import {
  ANALYZER_VERSION,
  MATCHER_VERSION,
  PARSER_VERSION,
  TRANSITION_COMPILER_VERSION,
  analyzeFormula,
  compileFormulaTransition,
  matchFormulaTrees,
  type FormulaAnalysis,
} from "../../formula-analysis/src/index.js";
import type {
  FormulaStatuses,
  TeachingDerivationDerivedV1,
  TeachingDerivationDocumentV1,
  TeachingFormulaDerivedV1,
  TeachingStepDerivedV1,
  TeachingStepTransitionV1,
} from "./types.js";

export function compileTeachingDerivation(
  document: TeachingDerivationDocumentV1,
): TeachingDerivationDerivedV1 {
  const steps: TeachingStepDerivedV1[] = [];
  let previousPrimary = new Map<string, FormulaAnalysis>();
  for (const step of document.steps) {
    const formulas: TeachingFormulaDerivedV1[] = [];
    const transitions: TeachingStepTransitionV1[] = [];
    const currentPrimary = new Map<string, FormulaAnalysis>();
    const allowMatch = step.relation !== "case_split";
    for (const formula of step.board) {
      const analysis = analyzeFormula(formula.latex, {
        symbols: document.symbols,
      });
      let animationStatus: FormulaStatuses["animationStatus"] = "formula";
      const sourceStep = formula.source
        ? steps[formula.source.stepIndex - 1]
        : undefined;
      const previous =
        allowMatch &&
        formula.change !== "introduce" &&
        (step.relation !== "introduce" ||
          formula.change === "transform" ||
          formula.change === "hold")
          ? formula.source
            ? sourceStep?.formulas.find(
                (item) => item.key === formula.source!.formulaKey,
              )?.analysis
            : previousPrimary.get(formula.key)
          : undefined;
      if (previous && formula.role === "primary") {
        const correspondence = matchFormulaTrees(previous, analysis);
        const transition = compileFormulaTransition(
          previous,
          analysis,
          correspondence,
        );
        animationStatus = transition.animationStatus;
        transitions.push({
          formulaKey: formula.key,
          correspondence,
          transition,
        });
      }
      formulas.push({
        key: formula.key,
        analysis,
        statuses: {
          syntaxStatus: analysis.syntaxStatus,
          analysisStatus: analysis.analysisStatus,
          mathVerification: "not_checked",
          animationStatus,
        },
      });
      if (formula.role === "primary") {
        currentPrimary.set(formula.key, analysis);
      }
    }
    previousPrimary = currentPrimary;
    steps.push({ index: step.index, formulas, transitions, presentation: compileTeachingPresentation(document, step) });
  }
  return {
    presentationVersion: TEACHING_PRESENTATION_VERSION,
    documentHash: teachingPresentationHash(document),
    parserVersion: PARSER_VERSION,
    analyzerVersion: ANALYZER_VERSION,
    matcherVersion: MATCHER_VERSION,
    compilerVersion: TRANSITION_COMPILER_VERSION,
    steps,
  };
}

/** Old derived caches are disposable; the committed document remains authority. */
export function resolveTeachingDerivationDerived(
  document: TeachingDerivationDocumentV1,
  stored?: TeachingDerivationDerivedV1 | null,
): TeachingDerivationDerivedV1 {
  return stored &&
    stored.presentationVersion === TEACHING_PRESENTATION_VERSION &&
    stored.documentHash === teachingPresentationHash(document) &&
    stored.parserVersion === PARSER_VERSION &&
    stored.analyzerVersion === ANALYZER_VERSION &&
    stored.matcherVersion === MATCHER_VERSION &&
    stored.compilerVersion === TRANSITION_COMPILER_VERSION &&
    stored.steps.length === document.steps.length
    ? stored
    : compileTeachingDerivation(document);
}
