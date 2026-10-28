import type {
  DerivationDocumentV1,
  DerivationStepV1,
  DerivationSubjectRef,
  FormulaDisplayRoleV1,
  MaterializedDerivationStateV1,
} from "@xue-learn/core/formal-derivation";
import type { SubjectRef } from "@xue-learn/core/formal-expression-core";

const STABLE_ROLES = new Set<FormulaDisplayRoleV1>(["assumption", "definition"]);
const OUTCOME_ROLES = new Set<FormulaDisplayRoleV1>(["result", "theorem"]);

export function formulaCaptionMap(document: DerivationDocumentV1 | undefined) {
  const labels: Record<string, string> = {};
  if (!document) return labels;
  const assign = (
    id: string,
    display?: { role?: FormulaDisplayRoleV1; caption?: string },
  ) => {
    if (display?.caption?.trim()) {
      labels[id] = display.caption.trim();
      return;
    }
    if (display?.role) labels[id] = display.role;
  };
  for (const seed of document.initialFormulas) {
    assign(seed.id, seed.display);
  }
  for (const step of document.steps) {
    for (const action of step.actions) {
      if (action.type === "formula.add") {
        assign(action.formula.id, action.formula.display);
      }
      if (action.type === "formula.set_metadata") {
        assign(action.formulaId, {
          role: action.patch.role,
          caption: action.patch.caption ?? labels[action.formulaId],
        });
      }
    }
  }
  return labels;
}

export function visibleFormulaTitle(
  formulaId: string,
  state: MaterializedDerivationStateV1,
  captions: Record<string, string>,
  index: number,
  fallback: string,
) {
  const formula = state.formulas[formulaId];
  return (
    formula?.display?.caption?.trim() ||
    captions[formulaId] ||
    fallback ||
    `公式 ${index + 1}`
  );
}

function isLegacyTargetTheorem(
  formulaId: string,
  state: MaterializedDerivationStateV1,
  captions: Record<string, string>,
) {
  if (state.formulas[formulaId]?.display?.role !== "theorem") return false;
  const caption =
    state.formulas[formulaId]?.display?.caption?.trim() ??
    captions[formulaId] ??
    "";
  return /^(?:最终)?目标\s*[:：]/.test(caption) || /^target\s*:/i.test(caption);
}

export function currentStepFormulaIds(
  state: MaterializedDerivationStateV1,
  step: DerivationStepV1 | undefined,
) {
  const visibleIds = state.presentation.visibleFormulaIds;
  if (!step) return visibleIds;
  const visible = new Set(visibleIds);
  const focused = new Set<string>();
  const supporting = new Set<string>();
  const narrated = new Set<string>();
  const addSubject = (
    target: Set<string>,
    subject: { type: string; formulaId?: string },
  ) => {
    if (subject.formulaId && visible.has(subject.formulaId)) {
      target.add(subject.formulaId);
    }
  };
  for (const action of step.actions) {
    if (action.type === "formula.add") supporting.add(action.formula.id);
    else supporting.add(action.formulaId);
  }
  for (const subject of step.presentation.focus ?? []) {
    addSubject(focused, subject);
  }
  for (const item of step.presentation.highlight ?? []) {
    addSubject(supporting, item.subject);
  }
  for (const narration of step.presentation.narration ?? []) {
    for (const subject of narration.related ?? []) {
      addSubject(narrated, subject);
    }
  }
  for (const item of step.presentation.formulaVisibility ?? []) {
    if (item.state === "visible" && visible.has(item.formulaId)) {
      supporting.add(item.formulaId);
    }
  }
  const relevant = focused.size
    ? focused
    : supporting.size
      ? supporting
      : narrated;
  const ids = visibleIds.filter((formulaId) => relevant.has(formulaId));
  return ids.length ? ids : visibleIds.slice(-1);
}

export function stableFormulaIds(
  state: MaterializedDerivationStateV1,
  activeFormulaIds: readonly string[],
  captions: Record<string, string>,
) {
  const active = new Set(activeFormulaIds);
  return state.presentation.visibleFormulaIds.filter((formulaId) => {
    if (active.has(formulaId)) return false;
    if (isLegacyTargetTheorem(formulaId, state, captions)) return false;
    const display = state.formulas[formulaId]?.display;
    return Boolean(
      display?.pinned || (display?.role && STABLE_ROLES.has(display.role)),
    );
  });
}

export function splitVisibleFormulas(
  state: MaterializedDerivationStateV1,
  captions: Record<string, string>,
) {
  const process: string[] = [];
  const outcome: string[] = [];
  for (const formulaId of state.presentation.visibleFormulaIds) {
    if (isLegacyTargetTheorem(formulaId, state, captions)) continue;
    const role = state.formulas[formulaId]?.display?.role;
    if (role && OUTCOME_ROLES.has(role)) outcome.push(formulaId);
    else process.push(formulaId);
  }
  if (!process.length) {
    return { boardIds: outcome, companionIds: [] as string[] };
  }
  return { boardIds: process, companionIds: outcome };
}

export function formulaHighlights(
  state: MaterializedDerivationStateV1,
  formulaId: string,
) {
  return (state.presentation.highlight ?? []).flatMap((item) => {
    if (
      item.subject.type !== "subject" ||
      item.subject.formulaId !== formulaId
    ) {
      return [];
    }
    return [
      {
        subject: item.subject.subject,
        tone: item.tone,
        emphasis: item.emphasis,
      },
    ];
  });
}

function subjectRefsForFormula(
  refs: DerivationSubjectRef[] | undefined,
  formulaId: string,
): SubjectRef[] {
  return (refs ?? []).flatMap((item) => {
    if (item.type !== "subject" || item.formulaId !== formulaId) {
      return [];
    }
    return [item.subject];
  });
}

function uniqueSubjects(subjects: SubjectRef[]): SubjectRef[] {
  const seen = new Set<string>();
  return subjects.filter((subject) => {
    const key = `${subject.type}:${subject.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Glyphs the 讲解 is pointing at: narration.related when present, otherwise focus. */
export function formulaFocus(
  state: MaterializedDerivationStateV1,
  formulaId: string,
) {
  const related = (state.presentation.narration ?? []).flatMap((item) =>
    subjectRefsForFormula(item.related, formulaId),
  );
  const focus = subjectRefsForFormula(state.presentation.focus, formulaId);
  return uniqueSubjects(related.length ? related : focus);
}

export function isFormulaLevelEmphasized(
  state: MaterializedDerivationStateV1,
  formulaId: string,
) {
  const relatedFormula = (state.presentation.narration ?? []).some((item) =>
    (item.related ?? []).some(
      (ref) => ref.type === "formula" && ref.formulaId === formulaId,
    ),
  );
  if (relatedFormula) return true;
  const focused = (state.presentation.focus ?? []).some(
    (item) => item.type === "formula" && item.formulaId === formulaId,
  );
  if (focused) return true;
  return (state.presentation.highlight ?? []).some(
    (item) =>
      item.subject.type === "formula" && item.subject.formulaId === formulaId,
  );
}

export function formulaHasTeachingEmphasis(
  state: MaterializedDerivationStateV1,
  formulaId: string,
) {
  if (isFormulaLevelEmphasized(state, formulaId)) return true;
  if (formulaFocus(state, formulaId).length > 0) return true;
  if (formulaHighlights(state, formulaId).length > 0) return true;
  return (state.presentation.focus ?? []).some(
    (item) =>
      (item.type === "formula" || item.type === "subject") &&
      item.formulaId === formulaId,
  );
}

/** Land on the first live step, then keep the learner's cursor until they move it. */
export function followLiveDerivationOrdinal(
  current: number,
  previousStepCount: number,
  nextStepCount: number,
): number {
  const nextMax = Math.max(0, nextStepCount);
  if (nextMax <= 0) return 1;
  if (previousStepCount <= 0) return 1;
  return Math.min(Math.max(1, current), nextMax);
}
