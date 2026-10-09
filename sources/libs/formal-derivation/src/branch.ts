import { DerivationError } from "./errors.js";
import { DERIVATION_LIMITS } from "./limits.js";
import type {
  DerivationBranchV1,
  DerivationCaseDeclV1,
  DerivationStepV1,
  DerivationTimelineItemV1,
  MaterializedBranchCursorV1,
} from "./types.js";

function uniqueCaseIds(cases: DerivationCaseDeclV1[]): boolean {
  return new Set(cases.map((item) => item.id)).size === cases.length;
}

export function applyBranchCursor(
  previous: MaterializedBranchCursorV1 | undefined,
  branch: DerivationBranchV1 | undefined,
  stepId: string,
): MaterializedBranchCursorV1 | undefined {
  if (!branch) {
    if (previous) {
      throw new DerivationError({
        code: "branch_scope_required",
        message:
          "A case split is open. Tag this step with branch.role \"case\" or \"join\"; do not interleave untagged trunk steps.",
        stepId,
      });
    }
    return undefined;
  }

  if (branch.role === "split") {
    if (previous) {
      throw new DerivationError({
        code: "branch_nested_split",
        message:
          "Finish the open case split with branch.role \"join\" before opening another. Nested splits are not supported.",
        stepId,
      });
    }
    const cases = branch.cases ?? [];
    if (
      cases.length < DERIVATION_LIMITS.minCasesPerSplit ||
      cases.length > DERIVATION_LIMITS.maxCasesPerSplit
    ) {
      throw new DerivationError({
        code: "branch_invalid",
        message: `A split must declare ${DERIVATION_LIMITS.minCasesPerSplit}–${DERIVATION_LIMITS.maxCasesPerSplit} cases.`,
        stepId,
      });
    }
    if (!uniqueCaseIds(cases)) {
      throw new DerivationError({
        code: "branch_invalid",
        message: "Case ids in a split must be unique.",
        stepId,
      });
    }
    return {
      splitId: branch.splitId,
      label: branch.label,
      cases,
      startedCaseIds: [],
    };
  }

  if (!previous || previous.splitId !== branch.splitId) {
    throw new DerivationError({
      code: "branch_unknown_split",
      message: `branch.splitId "${branch.splitId}" does not match the open split.`,
      stepId,
    });
  }

  if (branch.role === "case") {
    const caseId = branch.caseId;
    if (!caseId) {
      throw new DerivationError({
        code: "branch_invalid",
        message: "branch.caseId is required when role is \"case\".",
        stepId,
      });
    }
    const index = previous.cases.findIndex((item) => item.id === caseId);
    if (index < 0) {
      throw new DerivationError({
        code: "branch_unknown_case",
        message: `Case "${caseId}" was not declared on split "${previous.splitId}".`,
        stepId,
      });
    }
    const started = previous.startedCaseIds;
    const current = previous.currentCaseId;
    if (current === caseId) {
      return previous;
    }
    if (started.includes(caseId)) {
      throw new DerivationError({
        code: "branch_case_reopened",
        message:
          "Cases run one after another on a single timeline. Finish a case before starting the next; do not return to an earlier case.",
        stepId,
      });
    }
    const nextExpected = previous.cases[started.length]?.id;
    if (nextExpected !== caseId) {
      throw new DerivationError({
        code: "branch_case_order",
        message: `Cases must run in declared order. Next expected case is "${nextExpected ?? "join"}".`,
        stepId,
      });
    }
    return {
      ...previous,
      currentCaseId: caseId,
      startedCaseIds: [...started, caseId],
    };
  }

  if (previous.startedCaseIds.length !== previous.cases.length) {
    const missing = previous.cases
      .filter((item) => !previous.startedCaseIds.includes(item.id))
      .map((item) => item.id);
    throw new DerivationError({
      code: "branch_incomplete",
      message: `Cannot join until every declared case has at least one step. Missing: ${missing.join(", ")}.`,
      stepId,
    });
  }
  return undefined;
}

export function groupExpansionRuns(
  steps: readonly DerivationStepV1[],
): Array<Extract<DerivationTimelineItemV1, { type: "step" | "expansion" }>> {
  const items: Array<
    Extract<DerivationTimelineItemV1, { type: "step" | "expansion" }>
  > = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    if (!step) break;
    const expansionId = step.metadata?.expansion?.expansionId;
    if (!expansionId) {
      items.push({ type: "step", step });
      index += 1;
      continue;
    }
    const grouped: DerivationStepV1[] = [];
    while (index < steps.length) {
      const inner = steps[index];
      if (inner?.metadata?.expansion?.expansionId !== expansionId) break;
      grouped.push(inner);
      index += 1;
    }
    items.push({
      type: "expansion",
      expansionId,
      replacesStepId:
        grouped[0]?.metadata?.expansion?.replacesStepId ?? expansionId,
      steps: grouped,
    });
  }
  return items;
}

export function groupDerivationTimeline(
  steps: readonly DerivationStepV1[],
): DerivationTimelineItemV1[] {
  const items: DerivationTimelineItemV1[] = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    if (!step) break;
    if (step.branch?.role !== "split") {
      const trunk: DerivationStepV1[] = [];
      while (index < steps.length) {
        const inner = steps[index];
        if (!inner || inner.branch?.role === "split") break;
        trunk.push(inner);
        index += 1;
      }
      items.push(...groupExpansionRuns(trunk));
      continue;
    }
    const splitId = step.branch.splitId;
    const decls = step.branch.cases ?? [];
    const cases = decls.map((item) => ({
      id: item.id,
      label: item.label,
      assumption: item.assumption,
      steps: [] as DerivationStepV1[],
    }));
    const byId = new Map(cases.map((item) => [item.id, item]));
    let joinStep: DerivationStepV1 | undefined;
    index += 1;
    while (index < steps.length) {
      const inner = steps[index];
      if (!inner?.branch || inner.branch.splitId !== splitId) break;
      if (inner.branch.role === "join") {
        joinStep = inner;
        index += 1;
        break;
      }
      if (inner.branch.role === "case" && inner.branch.caseId) {
        const bucket = byId.get(inner.branch.caseId);
        if (bucket) bucket.steps.push(inner);
        else {
          cases.push({
            id: inner.branch.caseId,
            label: inner.branch.label ?? inner.branch.caseId,
            assumption: inner.branch.assumption,
            steps: [inner],
          });
          byId.set(inner.branch.caseId, cases[cases.length - 1]!);
        }
      }
      index += 1;
    }
    items.push({
      type: "split",
      splitId,
      label: step.branch.label,
      splitStep: step,
      cases,
      joinStep,
    });
  }
  return items;
}
