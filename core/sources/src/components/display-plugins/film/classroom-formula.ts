import {
  materializeAtStep,
  type DerivationDocumentV1,
} from "../../../../libs/formal-derivation/src/index.js";
import type { SubjectRef } from "../../../../libs/formal-expression-core/src/index.js";
import type {
  DerivationStepV1,
  MaterializedDerivationStateV1,
} from "../../../../libs/formal-derivation/src/index.js";
import {
  currentStepFormulaIds,
  stableFormulaIds,
  formulaFocus,
  formulaHasTeachingEmphasis,
  formulaHighlights,
  isFormulaLevelEmphasized,
} from "./formal-derivation-view.js";

export function classroomDisplayedFormulaId(
  state: MaterializedDerivationStateV1,
): string | undefined {
  const ids = state.presentation.visibleFormulaIds.filter(
    (id) => state.formulas[id],
  );
  const marked = ids.find((id) => formulaHasTeachingEmphasis(state, id));
  return marked ?? ids.at(-1) ?? Object.keys(state.formulas)[0];
}

/** Scene bounds are one-based ordinals; zero is the initial board. */
export function classroomDerivationFrame(
  document: DerivationDocumentV1,
  ordinal: number,
) {
  const bounded = Math.max(0, Math.min(ordinal, document.steps.length));
  return {
    state: materializeAtStep(document, bounded),
    step: document.steps[bounded - 1],
  };
}

/** Keep authored reference formulas alongside every formula taught by this step. */
export function classroomDisplayedFormulaIds(
  state: MaterializedDerivationStateV1,
  step?: DerivationStepV1,
): string[] {
  const active = currentStepFormulaIds(state, step);
  const reference = stableFormulaIds(state, active, {});
  const included = new Set([...reference, ...active]);
  return state.presentation.visibleFormulaIds.filter(
    (id) => included.has(id) && state.formulas[id],
  );
}

export function classroomFormulaEmphasis(
  state: MaterializedDerivationStateV1,
  formulaId: string,
): {
  selected: SubjectRef[];
  highlights: ReturnType<typeof formulaHighlights>;
} {
  const highlights = formulaHighlights(state, formulaId);
  if (isFormulaLevelEmphasized(state, formulaId)) {
    const snapshot = state.formulas[formulaId]?.document;
    return {
      selected: (snapshot?.roots ?? []).map((id) => ({
        type: "node" as const,
        id,
      })),
      highlights,
    };
  }
  return { selected: formulaFocus(state, formulaId), highlights };
}
