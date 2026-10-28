import {
  compileFormulaTransition,
  matchFormulaTrees,
  type FormulaAnalysis,
  type FormulaTransition,
} from "../../formula-analysis/src/index.js";
import type {
  BoardFormulaV1,
  StepReferenceV1,
  TeachingDerivationDerivedV1,
  TeachingDerivationDocumentV1,
} from "./types.js";

export function teachingFormulaSource(
  document: TeachingDerivationDocumentV1,
  ordinal: number,
  formula: BoardFormulaV1,
): StepReferenceV1 | undefined {
  if (formula.source) return formula.source;
  const step = document.steps[ordinal - 1];
  if (formula.role === "reference") {
    const index =
      step?.board
        .filter((item) => item.role === "reference")
        .findIndex((item) => item.key === formula.key) ?? -1;
    return (
      step?.references?.find((item) => item.formulaKey === formula.key) ??
      step?.references?.[index]
    );
  }
  if (
    formula.change === "introduce" ||
    step?.relation === "introduce" ||
    step?.relation === "case_split"
  )
    return undefined;
  return document.steps[ordinal - 2]?.board.some(
    (item) => item.role === "primary" && item.key === formula.key,
  )
    ? { stepIndex: ordinal - 1, formulaKey: formula.key }
    : undefined;
}

export type TeachingBoardTrack = {
  id: string;
  formula: BoardFormulaV1;
  source?: StepReferenceV1;
  after: FormulaAnalysis;
  before?: FormulaAnalysis;
  transition?: FormulaTransition;
  state: "hold" | "morph" | "enter" | "exit";
  cancelledNodeIds?: readonly string[];
  fromSlot: number;
  toSlot: number;
};

/** Stable per-lane slots, reconstructed from lineage rather than current row count.
 * Reserve surviving/source slots before placing independent new formulas. */
export function teachingBoardSlots(document: TeachingDerivationDocumentV1) {
  const steps: Map<string, number>[] = [];
  for (const step of document.steps) {
    const slots = new Map<string, number>();
    for (const role of ["primary", "reference"] as const) {
      const occupied = new Set<number>();
      const formulas = step.board.filter((f) => f.role === role);
      for (const formula of formulas) {
        const source = teachingFormulaSource(document, step.index, formula);
        const prior = document.steps[step.index - 2]?.board.find(
          (f) => f.key === formula.key && f.role === role,
        );
        const sourceFormula =
          source &&
          document.steps[source.stepIndex - 1]?.board.find(
            (f) => f.key === source.formulaKey && f.role === role,
          );
        const slot = prior
          ? steps[step.index - 2]?.get(formula.key)
          : sourceFormula && source
            ? steps[source.stepIndex - 1]?.get(source.formulaKey)
            : undefined;
        if (slot !== undefined && !occupied.has(slot)) {
          slots.set(formula.key, slot);
          occupied.add(slot);
        }
      }
      for (const formula of formulas) {
        if (slots.has(formula.key)) continue;
        let slot = 0;
        while (occupied.has(slot)) slot++;
        slots.set(formula.key, slot);
        occupied.add(slot);
      }
    }
    steps.push(slots);
  }
  return steps;
}

/** Fully reconstructible from committed snapshots; no previous React mount or
 * wall clock required. Stable source identity also survives reference renaming. */
export function teachingBoardTransition(
  document: TeachingDerivationDocumentV1,
  derived: TeachingDerivationDerivedV1,
  from: number,
  to: number,
): TeachingBoardTrack[] {
  const identity = (formula: BoardFormulaV1, ordinal: number) => {
    const source = teachingFormulaSource(document, ordinal, formula);
    return formula.role === "reference" && source
      ? `reference:${source.stepIndex}:${source.formulaKey}`
      : `${formula.role}:${formula.key}`;
  };
  const slots = teachingBoardSlots(document);
  const cards = (ordinal: number) =>
    (document.steps[ordinal - 1]?.board ?? []).map((formula) => ({
      formula,
      id: identity(formula, ordinal),
      slot: slots[ordinal - 1]?.get(formula.key) ?? 0,
      analysis: derived.steps[ordinal - 1]?.formulas.find(
        (item) => item.key === formula.key,
      )?.analysis,
    }));
  const current = cards(to);
  const previous = cards(from);
  const adjacent = Math.abs(to - from) === 1;
  const used = new Set<string>();
  const tracks: TeachingBoardTrack[] = [];
  for (const card of current) {
    if (!card.analysis) continue;
    const source = teachingFormulaSource(document, to, card.formula);
    const old =
      previous.find((item) => item.id === card.id) ??
      previous.find(
        (item) =>
          item.formula.role === card.formula.role &&
          card.formula.role === "primary" &&
          ((source?.stepIndex === from &&
            source.formulaKey === item.formula.key) ||
            (from > to &&
              item.formula.source?.stepIndex === to &&
              item.formula.source.formulaKey === card.formula.key)),
      );
    if (old) used.add(old.id);
    const unchanged = old?.formula.latex === card.formula.latex;
    const newer = document.steps[Math.max(from, to) - 1];
    const newerFormula = from > to ? old?.formula : card.formula;
    const canMorph =
      adjacent &&
      old?.analysis &&
      !unchanged &&
      card.formula.role === "primary" &&
      newer?.relation !== "case_split" &&
      newerFormula?.change !== "introduce" &&
      (newer?.relation !== "introduce" || newerFormula?.change === "transform");
    const action =
      derived.steps[Math.max(from, to) - 1]?.presentation?.actions.filter(
        (a) => a.formulaKey === newerFormula?.key,
      ) ?? [];
    const transition = canMorph
      ? compileFormulaTransition(
          old!.analysis!,
          card.analysis,
          matchFormulaTrees(old!.analysis!, card.analysis),
        )
      : undefined;
    const actionPairs = action
      .flatMap((a) => a.pairs)
      .map((pair) =>
        from > to
          ? { beforeNodeId: pair.afterNodeId, afterNodeId: pair.beforeNodeId }
          : pair,
      );
    if (transition && actionPairs.length) {
      const explicit = actionPairs.map((pair, i) => ({
        ...pair,
        op: "move" as const,
        correspondenceId: `teaching-action-${i}`,
      }));
      // Explicit verified pairs are authoritative, including one-to-many distribution.
      Object.assign(transition, {
        regions: [
          ...explicit,
          ...transition.regions.filter(
            (r) =>
              !actionPairs.some(
                (p) =>
                  p.beforeNodeId === r.beforeNodeId ||
                  p.afterNodeId === r.afterNodeId,
              ),
          ),
        ],
      });
    }
    tracks.push({
      id: card.id,
      formula: card.formula,
      source,
      after: card.analysis,
      before: canMorph ? old!.analysis : undefined,
      transition,
      cancelledNodeIds:
        from < to ? action.flatMap((a) => a.cancelledNodeIds) : [],
      state:
        unchanged || from === to || !adjacent
          ? "hold"
          : canMorph
            ? "morph"
            : "enter",
      fromSlot: old?.slot ?? card.slot,
      toSlot: card.slot,
    });
    // Unrelated replacement in a reused card must dissolve its old contents,
    // never morph merely because the author reused the same key.
    if (old?.analysis && adjacent && !unchanged && !canMorph) {
      tracks.push({
        id: `${old.id}:outgoing`,
        formula: old.formula,
        after: old.analysis,
        source: teachingFormulaSource(document, from, old.formula),
        state: "exit",
        fromSlot: old.slot,
        toSlot: old.slot,
      });
    }
  }
  if (adjacent)
    for (const old of previous) {
      if (!used.has(old.id) && old.analysis)
        tracks.push({
          id: old.id,
          formula: old.formula,
          after: old.analysis,
          source: teachingFormulaSource(document, from, old.formula),
          state: "exit",
          fromSlot: old.slot,
          toSlot: old.slot,
        });
    }
  return tracks;
}

export function teachingBlockFrame(
  track: Pick<TeachingBoardTrack, "state" | "fromSlot" | "toSlot">,
  progress: number,
) {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const smooth = (value: number) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  const t = clamp(progress);
  const enter = smooth((t - 0.15) / 0.85);
  // Keep surrounding work visible while the main formula transforms.
  const exit = 1 - smooth((t - 0.75) / 0.25);
  return {
    opacity:
      track.state === "enter" ? enter : track.state === "exit" ? exit : 1,
    offsetY:
      track.state === "enter"
        ? (1 - enter) * 20
        : track.state === "exit"
          ? -(1 - exit) * 10
          : 0,
    slot: track.fromSlot + (track.toSlot - track.fromSlot) * smooth(t),
  };
}
