import type {
  DerivationPresentationV1,
  MaterializedPresentationStateV1,
} from "./types.js";

export function emptyPresentationState(): MaterializedPresentationStateV1 {
  return {
    visibleFormulaIds: [],
    narration: undefined,
    focus: [],
    highlight: [],
    dimOthers: false,
  };
}

export function isObservablePresentation(
  presentation: DerivationPresentationV1,
): boolean {
  return Boolean(
    (presentation.narration && presentation.narration.length > 0) ||
      (presentation.focus && presentation.focus.length > 0) ||
      (presentation.highlight && presentation.highlight.length > 0) ||
      (presentation.formulaVisibility &&
        presentation.formulaVisibility.length > 0) ||
      presentation.dimOthers === true ||
      (typeof presentation.pauseMs === "number" && presentation.pauseMs > 0),
  );
}

export function applyPresentation(
  previous: MaterializedPresentationStateV1,
  next: DerivationPresentationV1,
  introducedFormulaIds: string[],
): MaterializedPresentationStateV1 {
  const visible = new Set(previous.visibleFormulaIds);
  for (const formulaId of introducedFormulaIds) visible.add(formulaId);
  for (const item of next.formulaVisibility ?? []) {
    if (item.state === "visible") visible.add(item.formulaId);
    else visible.delete(item.formulaId);
  }
  return {
    visibleFormulaIds: [...visible],
    narration: next.narration,
    focus: next.focus ?? [],
    highlight: next.highlight ?? [],
    dimOthers: next.dimOthers ?? false,
    pauseMs: next.pauseMs,
  };
}

export function countPresentationTargets(
  presentation: DerivationPresentationV1,
): number {
  return (
    (presentation.focus?.length ?? 0) + (presentation.highlight?.length ?? 0)
  );
}
