import { decompileAuthoringTree } from "../../formal-expression-core/src/index.js";
import { DerivationError } from "./errors.js";
import { DERIVATION_LIMITS } from "./limits.js";
import {
  applyDerivationStep,
  commitDerivationStep,
  replayDerivation,
} from "./materialize.js";
import { structuralAuthoringTree } from "./notation.js";
import type {
  CommitDerivationStepArgsV1,
  DerivationDocumentV1,
  DerivationStepV1,
  MaterializedDerivationStateV1,
  MaterializedFormulaStateV1,
} from "./types.js";

export function canExpandDerivationStep(
  step: Pick<DerivationStepV1, "branch" | "metadata">,
): boolean {
  if (step.branch?.role === "split" || step.branch?.role === "join") {
    return false;
  }
  return !step.metadata?.expansion;
}

export function replacementArgsFromStep(
  step: DerivationStepV1,
): CommitDerivationStepArgsV1 {
  return {
    baseRevision: step.baseRevision,
    summary: step.metadata?.summary ?? "展开",
    actions: step.actions,
    presentation: step.presentation,
    branch: step.branch,
    kind: step.kind,
    source: step.metadata?.source ?? "agent",
    toolCallId: step.metadata?.toolCallId,
    ruleIds: step.metadata?.ruleIds,
    stepId: step.id,
  };
}

function fingerprintFormula(formula: MaterializedFormulaStateV1): string {
  return JSON.stringify({
    tree: structuralAuthoringTree(decompileAuthoringTree(formula.document)),
    display: {
      role: formula.display?.role ?? null,
      caption: formula.display?.caption ?? null,
      pinned: formula.display?.pinned ?? false,
    },
  });
}

function sortedFacts(state: MaterializedDerivationStateV1): string[] {
  return [...state.facts].sort();
}

function visibleOriginalIds(
  state: MaterializedDerivationStateV1,
  originalIds: Set<string>,
): string[] {
  return state.presentation.visibleFormulaIds
    .filter((id) => originalIds.has(id))
    .sort();
}

function suffixReservedFormulaIds(suffix: readonly DerivationStepV1[]): Set<string> {
  const reserved = new Set<string>();
  for (const step of suffix) {
    for (const action of step.actions) {
      if (action.type === "formula.add") reserved.add(action.formula.id);
    }
  }
  return reserved;
}

function rewriteSuffixStep(
  step: DerivationStepV1,
  ordinalDelta: number,
  formulaRevisionDelta: Map<string, number>,
): DerivationStepV1 {
  return {
    ...step,
    ordinal: step.ordinal + ordinalDelta,
    baseRevision: step.baseRevision + ordinalDelta,
    afterRevision: step.afterRevision + ordinalDelta,
    actions: step.actions.map((action) => {
      if (
        action.type === "formula.transform" ||
        action.type === "subject.set_attribute"
      ) {
        const delta = formulaRevisionDelta.get(action.formulaId) ?? 0;
        if (!delta) return action;
        return {
          ...action,
          baseFormulaRevision: action.baseFormulaRevision + delta,
        };
      }
      return action;
    }),
  };
}

function formulaRevisionDelta(
  originalAfter: MaterializedDerivationStateV1,
  expansionAfter: MaterializedDerivationStateV1,
): Map<string, number> {
  const delta = new Map<string, number>();
  for (const formulaId of Object.keys(originalAfter.formulas)) {
    const before = originalAfter.formulas[formulaId]?.revision ?? 0;
    const after = expansionAfter.formulas[formulaId]?.revision ?? 0;
    if (after !== before) delta.set(formulaId, after - before);
  }
  return delta;
}

function hideExtraFormulas(
  step: DerivationStepV1,
  extraIds: string[],
): DerivationStepV1 {
  const already = new Set(
    (step.presentation.formulaVisibility ?? [])
      .filter((item) => item.state === "hidden")
      .map((item) => item.formulaId),
  );
  const missing = extraIds.filter((id) => !already.has(id));
  if (!missing.length) return step;
  return {
    ...step,
    presentation: {
      ...step.presentation,
      formulaVisibility: [
        ...(step.presentation.formulaVisibility ?? []),
        ...missing.map((formulaId) => ({
          formulaId,
          state: "hidden" as const,
        })),
      ],
    },
  };
}

function assertExpandable(replaced: DerivationStepV1): void {
  if (replaced.branch?.role === "split" || replaced.branch?.role === "join") {
    throw new DerivationError({
      code: "expansion_marker_forbidden",
      message: "Do not expand a case-split or join marker. Expand a teaching step inside a case instead.",
      stepId: replaced.id,
    });
  }
  if (replaced.metadata?.expansion) {
    throw new DerivationError({
      code: "expansion_depth",
      message: `This step is already part of an expansion. Collapse it before expanding again (max depth ${DERIVATION_LIMITS.maxExpansionDepth}).`,
      stepId: replaced.id,
    });
  }
}

function assertSeam(input: {
  replaced: DerivationStepV1;
  originalAfter: MaterializedDerivationStateV1;
  expansionAfter: MaterializedDerivationStateV1;
  suffix: readonly DerivationStepV1[];
}): void {
  const originalIds = new Set(Object.keys(input.originalAfter.formulas));
  for (const formulaId of originalIds) {
    const original = input.originalAfter.formulas[formulaId];
    const next = input.expansionAfter.formulas[formulaId];
    if (!original) continue;
    if (!next) {
      throw new DerivationError({
        code: "expansion_seam_mismatch",
        message: `Expansion must still contain formula ${formulaId} at the replaced step's after-state.`,
        stepId: input.replaced.id,
        formulaId,
      });
    }
    if (fingerprintFormula(original) !== fingerprintFormula(next)) {
      throw new DerivationError({
        code: "expansion_seam_mismatch",
        message: `Expansion must finish with the same tree for formula ${formulaId} as the replaced step.`,
        stepId: input.replaced.id,
        formulaId,
      });
    }
  }

  const extraIds = Object.keys(input.expansionAfter.formulas).filter(
    (id) => !originalIds.has(id),
  );
  const reserved = suffixReservedFormulaIds(input.suffix);
  for (const extraId of extraIds) {
    if (reserved.has(extraId)) {
      throw new DerivationError({
        code: "expansion_formula_collision",
        message: `Expansion introduced formula ${extraId}, which a later step also adds.`,
        stepId: input.replaced.id,
        formulaId: extraId,
      });
    }
    if (input.expansionAfter.presentation.visibleFormulaIds.includes(extraId)) {
      throw new DerivationError({
        code: "expansion_extra_visible",
        message: `Temporary expansion formula ${extraId} must be hidden before the seam so later steps keep their stage.`,
        stepId: input.replaced.id,
        formulaId: extraId,
      });
    }
  }

  if (
    JSON.stringify(sortedFacts(input.originalAfter)) !==
    JSON.stringify(sortedFacts(input.expansionAfter))
  ) {
    throw new DerivationError({
      code: "expansion_seam_mismatch",
      message: "Expansion must establish the same durable facts as the replaced step.",
      stepId: input.replaced.id,
    });
  }

  if (
    JSON.stringify(visibleOriginalIds(input.originalAfter, originalIds)) !==
    JSON.stringify(visibleOriginalIds(input.expansionAfter, originalIds))
  ) {
    throw new DerivationError({
      code: "expansion_seam_mismatch",
      message: "Expansion must leave the original formulas with the same visibility as the replaced step.",
      stepId: input.replaced.id,
    });
  }
}

function commitReplacement(input: {
  before: MaterializedDerivationStateV1;
  replaced: DerivationStepV1;
  replacement: CommitDerivationStepArgsV1[];
  expansionId: string;
}): {
  steps: DerivationStepV1[];
  after: MaterializedDerivationStateV1;
} {
  const { replaced, expansionId } = input;
  if (
    input.replacement.length < DERIVATION_LIMITS.minExpansionSteps ||
    input.replacement.length > DERIVATION_LIMITS.maxExpansionSteps
  ) {
    throw new DerivationError({
      code: "expansion_step_count",
      message: `An expansion must insert ${DERIVATION_LIMITS.minExpansionSteps}–${DERIVATION_LIMITS.maxExpansionSteps} steps.`,
      stepId: replaced.id,
    });
  }

  const committed: DerivationStepV1[] = [];
  let state = input.before;
  for (let index = 0; index < input.replacement.length; index += 1) {
    const args = input.replacement[index]!;
    const branch = args.branch ?? replaced.branch;
    if (replaced.branch && args.branch && args.branch.splitId !== replaced.branch.splitId) {
      throw new DerivationError({
        code: "expansion_branch_mismatch",
        message: "Expansion steps must keep the replaced step's case-split tags.",
        stepId: replaced.id,
      });
    }
    const result = commitDerivationStep(state, {
      ...args,
      baseRevision: state.derivationRevision,
      branch,
      source: args.source ?? "agent",
      stepId: args.stepId ?? `${expansionId}-${index + 1}`,
    });
    committed.push({
      ...result.step,
      metadata: {
        ...result.step.metadata,
        source: result.step.metadata?.source ?? "agent",
        summary: result.step.metadata?.summary ?? args.summary,
        expansion: {
          expansionId,
          replacesStepId: replaced.id,
          index,
          count: input.replacement.length,
          depth: 1,
        },
      },
    });
    state = result.state;
  }

  return { steps: committed, after: state };
}

function hideSeamExtras(input: {
  before: MaterializedDerivationStateV1;
  originalAfter: MaterializedDerivationStateV1;
  steps: DerivationStepV1[];
  after: MaterializedDerivationStateV1;
}): { steps: DerivationStepV1[]; after: MaterializedDerivationStateV1 } {
  const extraIds = Object.keys(input.after.formulas).filter(
    (id) => !input.originalAfter.formulas[id],
  );
  const last = input.steps.at(-1);
  if (!last || extraIds.length === 0) {
    return { steps: input.steps, after: input.after };
  }
  const hidden = hideExtraFormulas(last, extraIds);
  if (hidden === last) return { steps: input.steps, after: input.after };
  const steps = [...input.steps.slice(0, -1), hidden];
  let after = input.before;
  for (const step of steps) {
    after = applyDerivationStep(after, step).state;
  }
  return { steps, after };
}

export function spliceExpansion(
  document: DerivationDocumentV1,
  replacedStepId: string,
  replacement: Array<CommitDerivationStepArgsV1 | DerivationStepV1>,
  options: { expansionId?: string } = {},
): {
  document: DerivationDocumentV1;
  expansionId: string;
  insertedCount: number;
} {
  const index = document.steps.findIndex((step) => step.id === replacedStepId);
  if (index < 0) {
    throw new DerivationError({
      code: "expansion_missing_step",
      message: `Step ${replacedStepId} is not on the playback timeline.`,
      stepId: replacedStepId,
    });
  }
  const replaced = document.steps[index]!;
  assertExpandable(replaced);

  const prefix = document.steps.slice(0, index);
  const suffix = document.steps.slice(index + 1);
  const insertedCount = replacement.length;
  if (prefix.length + insertedCount + suffix.length > DERIVATION_LIMITS.maxStepsPerRun) {
    throw new DerivationError({
      code: "limit_exceeded",
      message: `A run may commit at most ${DERIVATION_LIMITS.maxStepsPerRun} steps.`,
      stepId: replaced.id,
    });
  }

  const before = replayDerivation(document, { throughOrdinal: replaced.ordinal - 1 });
  const originalAfter = applyDerivationStep(before, replaced).state;
  const expansionId = options.expansionId ?? `exp-${replaced.id}`;
  const args = replacement.map((item) =>
    "ordinal" in item && "afterRevision" in item
      ? replacementArgsFromStep(item)
      : item,
  );
  const committed = hideSeamExtras({
    before,
    originalAfter,
    ...commitReplacement({
      before,
      replaced,
      replacement: args,
      expansionId,
    }),
  });
  assertSeam({
    replaced,
    originalAfter,
    expansionAfter: committed.after,
    suffix,
  });

  const ordinalDelta = committed.steps.length - 1;
  const rewrittenSuffix = suffix.map((step) =>
    rewriteSuffixStep(
      step,
      ordinalDelta,
      formulaRevisionDelta(originalAfter, committed.after),
    ),
  );
  const nextSteps = [...prefix, ...committed.steps, ...rewrittenSuffix];
  try {
    replayDerivation({ ...document, steps: nextSteps, revision: nextSteps.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DerivationError({
      code: "expansion_suffix_invalid",
      message: `Expansion seam was valid but later steps no longer replay: ${message}`,
      stepId: replaced.id,
    });
  }

  const archived: DerivationStepV1 = {
    ...replaced,
    metadata: {
      ...replaced.metadata,
      source: replaced.metadata?.source ?? "agent",
      supersededByExpansionId: expansionId,
    },
  };

  return {
    expansionId,
    insertedCount: committed.steps.length,
    document: {
      ...document,
      status: document.status === "failed" ? "failed" : "draft",
      revision: nextSteps.length,
      steps: nextSteps,
      archivedSteps: [...(document.archivedSteps ?? []), archived],
      completion: undefined,
    },
  };
}

export function collapseExpansion(
  document: DerivationDocumentV1,
  expansionId: string,
): DerivationDocumentV1 {
  const start = document.steps.findIndex(
    (step) => step.metadata?.expansion?.expansionId === expansionId,
  );
  if (start < 0) {
    throw new DerivationError({
      code: "expansion_missing_step",
      message: `Expansion ${expansionId} is not on the playback timeline.`,
    });
  }
  let end = start;
  while (
    end + 1 < document.steps.length &&
    document.steps[end + 1]?.metadata?.expansion?.expansionId === expansionId
  ) {
    end += 1;
  }
  const expansionSteps = document.steps.slice(start, end + 1);
  const archived = (document.archivedSteps ?? []).find(
    (step) => step.metadata?.supersededByExpansionId === expansionId,
  );
  if (!archived) {
    throw new DerivationError({
      code: "expansion_missing_original",
      message: `The original step for expansion ${expansionId} is not archived.`,
    });
  }

  const prefix = document.steps.slice(0, start);
  const suffix = document.steps.slice(end + 1);
  const before = replayDerivation(document, {
    throughOrdinal: expansionSteps[0]!.ordinal - 1,
  });
  const restored = commitDerivationStep(before, {
    ...replacementArgsFromStep(archived),
    baseRevision: before.derivationRevision,
    stepId: archived.id,
  });
  const expansionAfter = replayDerivation(
    { ...document, steps: [...prefix, ...expansionSteps] },
    { throughOrdinal: expansionSteps.at(-1)!.ordinal },
  );
  const rewrittenSuffix = suffix.map((step) =>
    rewriteSuffixStep(
      step,
      1 - expansionSteps.length,
      formulaRevisionDelta(expansionAfter, restored.state),
    ),
  );
  const nextSteps = [...prefix, restored.step, ...rewrittenSuffix];
  replayDerivation({ ...document, steps: nextSteps, revision: nextSteps.length });
  return {
    ...document,
    status: document.status === "failed" ? "failed" : "draft",
    revision: nextSteps.length,
    steps: nextSteps,
    archivedSteps: (document.archivedSteps ?? []).filter(
      (step) => step.metadata?.supersededByExpansionId !== expansionId,
    ),
    completion: undefined,
  };
}
