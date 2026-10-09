import { decompileAuthoringTree } from "../../formal-expression-core/src/index.js";
import { DerivationError } from "./errors.js";
import { DERIVATION_LIMITS } from "./limits.js";
import { replayDerivation, unresolvedPlaceholders } from "./materialize.js";
import { notationFindingsForTree } from "./notation.js";
import { parseDerivationDocument } from "./schema.js";
import type {
  DerivationCheckpointV1,
  DerivationDocumentV1,
  ValidationFindingV1,
} from "./types.js";

export function validateDerivationDocument(
  document: DerivationDocumentV1,
  checkpoints?: DerivationCheckpointV1[],
): {
  ok: boolean;
  findings: ValidationFindingV1[];
  validationLevel: "formal" | "rule_checked";
} {
  const findings: ValidationFindingV1[] = [];
  let parsed: DerivationDocumentV1;
  try {
    parsed = parseDerivationDocument(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      validationLevel: "formal",
      findings: [
        {
          level: "schema",
          severity: "error",
          code:
            error instanceof DerivationError ? error.code : "schema_invalid",
          message,
        },
      ],
    };
  }
  if (parsed.steps.length > DERIVATION_LIMITS.maxStepsPerRun) {
    findings.push({
      level: "schema",
      severity: "error",
      code: "limit_exceeded",
      message: `A derivation may contain at most ${DERIVATION_LIMITS.maxStepsPerRun} steps.`,
    });
  }
  try {
    const state = replayDerivation(parsed, { checkpoints });
    for (const placeholder of unresolvedPlaceholders(state)) {
      findings.push({
        level: "formal",
        severity: "error",
        code: "unresolved_placeholder",
        message: `Formula ${placeholder.formulaId} still has placeholder ${placeholder.nodeId}.`,
        formulaId: placeholder.formulaId,
      });
    }
    for (const [formulaId, formula] of Object.entries(state.formulas)) {
      findings.push(
        ...notationFindingsForTree(
          decompileAuthoringTree(formula.document),
          formulaId,
        ),
      );
    }
    if (Object.keys(state.formulas).length === 0) {
      findings.push({
        level: "schema",
        severity: "error",
        code: "empty_derivation",
        message: "A finished derivation must contain at least one formula.",
      });
    }
    const hasResult = Object.values(state.formulas).some(
      (formula) => formula.display?.role === "result",
    );
    if (parsed.requirement.target && !hasResult) {
      findings.push({
        level: "schema",
        severity: "warning",
        code: "requirement_coverage",
        message:
          "No formula is marked as the derived result covering the stated target.",
      });
    }
    if (state.branch) {
      findings.push({
        level: "schema",
        severity: "error",
        code: "branch_unjoined",
        message:
          "An open case split must be closed with a join step before the derivation can finish.",
      });
    }
    const usedRules = parsed.steps.some(
      (step) =>
        Boolean(step.metadata?.ruleIds?.length) ||
        step.actions.some(
          (action) =>
            action.type === "formula.transform" &&
            action.transform.type !== "replace_subtree" &&
            action.transform.type !== "relocate_subtree" &&
            action.transform.type !== "swap_subtrees" &&
            action.transform.type !== "substitute" &&
            action.transform.type !== "substitute_many",
        ),
    );
    const mathematicalErrors = findings.filter(
      (item) => item.level === "mathematical",
    );
    return {
      ok: findings.every((item) => item.severity !== "error"),
      findings,
      validationLevel:
        usedRules && mathematicalErrors.length === 0
          ? "rule_checked"
          : "formal",
    };
  } catch (error) {
    const derivationError =
      error instanceof DerivationError ? error : undefined;
    findings.push({
      level:
        derivationError?.code === "rule_precondition" ||
        derivationError?.code === "ungrouped_product_operand" ||
        derivationError?.code === "ungrouped_function_argument" ||
        derivationError?.code === "malformed_quantifier" ||
        derivationError?.code === "opaque_teaching_notation" ||
        derivationError?.code === "incomplete_fraction"
          ? "mathematical"
          : "formal",
      severity: "error",
      code: derivationError?.code ?? "replay_failed",
      message: error instanceof Error ? error.message : String(error),
      formulaId: derivationError?.formulaId,
      stepId: derivationError?.stepId,
    });
    return {
      ok: false,
      findings,
      validationLevel: "formal",
    };
  }
}

export function compactDerivationInspect(document: DerivationDocumentV1) {
  const state = replayDerivation(document);
  return {
    derivationRevision: state.derivationRevision,
    currentStepId: state.currentStepId,
    facts: state.facts,
    presentation: state.presentation,
    remainingSteps: Math.max(
      0,
      DERIVATION_LIMITS.maxStepsPerRun - document.steps.length,
    ),
    branch: state.branch ?? null,
    formulas: Object.entries(state.formulas).map(([formulaId, formula]) => ({
      formulaId,
      revision: formula.revision,
      display: formula.display,
      provenance: formula.provenance,
      nodeIds: Object.keys(formula.document.nodes),
      tree: decompileAuthoringTree(formula.document),
    })),
  };
}
