import { compileTeachingPresentation } from "./teaching-plan.js";
import {
  commitTeachingStepArgsSchema,
  teachingDerivationDocumentSchema,
} from "./schema.js";
import { latexTypesetError } from "./typeset.js";
import { teachingVisualIssues } from "./visual.js";
import { TEACHING_DERIVATION_STEP_LIMIT } from "./types.js";
import type {
  BoardFormulaV1,
  TeachingDerivationDocumentV1,
  TeachingDerivationStepV1,
} from "./types.js";

export type TeachingDerivationIssue = Readonly<{
  code: string;
  message: string;
  path?: string;
}>;

export function parseTeachingDerivationDocument(
  value: unknown,
): TeachingDerivationDocumentV1 | null {
  const parsed = teachingDerivationDocumentSchema.safeParse(value);
  return parsed.success ? (parsed.data as TeachingDerivationDocumentV1) : null;
}

export function normalizeCommitStepArgs(
  args: unknown,
): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const record = { ...(args as Record<string, unknown>) };
  if (record.formulas && !record.board) record.board = record.formulas;
  if (record.reason && !record.justification) {
    record.justification = record.reason;
  }
  if (record.basis && !record.justification) {
    record.justification = record.basis;
  }
  if (record.speech && !record.narration) record.narration = record.speech;
  if (record.explain && !record.narration) record.narration = record.explain;
  if (record.focus && !record.focusFormulaKey) {
    record.focusFormulaKey = record.focus;
  }
  if (record.relation === "intro") record.relation = "introduce";
  if (record.relation === "equivalent") record.relation = "equivalence";
  if (record.relation === "derive") record.relation = "imply";
  if (record.relation === "cases") record.relation = "case_split";
  if (record.relation === "narrate") record.relation = "narrate_only";
  return record;
}

export function validateCommittedStep(
  document: TeachingDerivationDocumentV1,
  rawStep: unknown,
): {
  ok: boolean;
  step?: TeachingDerivationStepV1;
  setup?: {
    teachingGoal?: string;
    givens?: readonly string[];
    symbols?: TeachingDerivationDocumentV1["symbols"];
  };
  issues: TeachingDerivationIssue[];
} {
  const parsed = commitTeachingStepArgsSchema.safeParse(rawStep);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        message: issue.message,
        path: issue.path.join("."),
      })),
    };
  }
  const nextIndex = document.steps.length + 1;
  if (nextIndex > TEACHING_DERIVATION_STEP_LIMIT) {
    return {
      ok: false,
      issues: [
        {
          code: "step_limit",
          message: `A run may commit at most ${TEACHING_DERIVATION_STEP_LIMIT} steps.`,
        },
      ],
    };
  }
  let board = copyReferenceLatex(
    document,
    parsed.data.board as BoardFormulaV1[],
    parsed.data.references,
  );
  const issues: TeachingDerivationIssue[] = [];
  const previous = document.steps.at(-1);
  const transforms = ["equivalence", "imply", "substitute"].includes(
    parsed.data.relation,
  );
  board = board.map((formula) => {
    const implicit = previous?.board.find(
      (item) => item.key === formula.key && item.role === formula.role,
    );
    const source =
      formula.source ??
      ((formula.role === "primary" || formula.change === "hold") &&
      implicit &&
      (parsed.data.relation !== "introduce" ||
        formula.change === "hold" ||
        formula.change === "transform") &&
      formula.change !== "introduce" &&
      parsed.data.relation !== "case_split"
        ? { stepIndex: previous!.index, formulaKey: formula.key }
        : undefined);
    const prior = source
      ? document.steps[source.stepIndex - 1]?.board.find(
          (item) => item.key === source.formulaKey,
        )
      : undefined;
    if (source && (!prior || source.stepIndex >= nextIndex)) {
      issues.push({
        code: "invalid_formula_source",
        path: formula.key,
        message: `Formula ${formula.key} must source an existing earlier formula. Inspect the committed board and retry.`,
      });
    }
    if (
      (transforms ||
        formula.change === "transform" ||
        formula.change === "hold") &&
      formula.change !== "introduce" &&
      formula.role === "primary" &&
      !source
    ) {
      issues.push({
        code: "missing_formula_source",
        path: formula.key,
        message: `Transformation ${formula.key} has no predecessor. Keep the previous working key or specify source {stepIndex, formulaKey}; use introduce only for a genuinely new formula.`,
      });
    }
    if (
      formula.change === "hold" &&
      (!prior || prior.latex !== formula.latex)
    ) {
      issues.push({
        code: "hold_changes_formula",
        path: formula.key,
        message:
          "hold must keep the exact source formula. Use transform with a valid source for changes.",
      });
    }
    if (formula.change === "introduce" && implicit) {
      issues.push({
        code: "introduced_key_reused",
        path: formula.key,
        message:
          "A new independent block needs a new key. Keep the existing working key for hold or transform.",
      });
    }
    if (
      parsed.data.relation === "narrate_only" &&
      formula.role === "primary" &&
      (!prior || prior.latex !== formula.latex)
    ) {
      issues.push({
        code: "narration_changes_formula",
        path: formula.key,
        message:
          "narrate_only must preserve the working formula exactly; use a transformation relation for a changed formula.",
      });
    }
    return {
      ...formula,
      ...(source ? { source } : {}),
      ...(formula.role === "reference" && prior ? { latex: prior.latex } : {}),
    };
  });
  if (parsed.data.relation === "narrate_only" && previous) {
    for (const formula of previous.board.filter(
      (item) => item.role === "primary",
    )) {
      if (
        !board.some(
          (item) =>
            item.key === formula.key &&
            item.role === "primary" &&
            item.latex === formula.latex,
        )
      ) {
        issues.push({
          code: "narration_drops_working_formula",
          path: formula.key,
          message:
            "Keep every current working formula on narrate_only boards. Reference explanations must not erase the derivation.",
        });
      }
    }
  }
  if (
    transforms &&
    !board.some(
      (formula) => formula.role === "primary" && formula.change !== "introduce",
    )
  ) {
    issues.push({
      code: "transformation_without_working_formula",
      message:
        "A transformation step must retain or transform a working formula; use introduce for an entirely new board.",
    });
  }
  if (
    document.steps.length &&
    document.givens.length &&
    parsed.data.givens &&
    JSON.stringify(parsed.data.givens) !== JSON.stringify(document.givens)
  ) {
    issues.push({
      code: "givens_changed",
      message:
        "Document givens are fixed premises. Put branch-specific restrictions in step.conditions; do not rewrite the original premises.",
    });
  }
  const keys = new Set<string>();
  for (const formula of board) {
    if (keys.has(formula.key)) {
      issues.push({
        code: "duplicate_formula_key",
        message: `Formula key ${formula.key} is repeated on this board.`,
        path: formula.key,
      });
    }
    keys.add(formula.key);
    const typeset = latexTypesetError(formula.latex);
    if (typeset) {
      issues.push({
        code: "latex_typeset",
        message: `Formula ${formula.key} cannot be typeset: ${typeset}`,
        path: formula.key,
      });
    }
  }
  if (
    !board.some((formula) => formula.role === "primary") &&
    parsed.data.relation !== "narrate_only"
  ) {
    issues.push({
      code: "missing_primary",
      message:
        "Each teaching step needs at least one primary formula, unless it is narrate_only.",
    });
  }
  if (!keys.has(parsed.data.focusFormulaKey)) {
    issues.push({
      code: "focus_missing",
      message: `focusFormulaKey ${parsed.data.focusFormulaKey} is not on this board.`,
    });
  }
  for (const reference of parsed.data.references ?? []) {
    const prior = document.steps[reference.stepIndex - 1];
    if (!prior || reference.stepIndex >= nextIndex) {
      issues.push({
        code: "bad_reference",
        message: `Step ${reference.stepIndex} is not an earlier committed step.`,
      });
      continue;
    }
    if (!prior.board.some((formula) => formula.key === reference.formulaKey)) {
      issues.push({
        code: "bad_reference",
        message: `Step ${reference.stepIndex} has no formula ${reference.formulaKey}.`,
      });
    }
  }
  const candidate: TeachingDerivationStepV1 = {
    ...parsed.data, index: nextIndex, board,
    narration: parsed.data.cues?.map(cue => cue.text).join("") ?? parsed.data.narration,
  };
  issues.push(...teachingVisualIssues({ ...document, givens: parsed.data.givens ?? document.givens }, candidate));
  issues.push(...compileTeachingPresentation({ ...document, symbols: parsed.data.symbols ?? document.symbols }, candidate).issues);
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    issues: [],
    step: candidate,
    setup: {
      ...(typeof parsed.data.teachingGoal === "string"
        ? { teachingGoal: parsed.data.teachingGoal }
        : {}),
      ...(parsed.data.givens ? { givens: parsed.data.givens } : {}),
      ...(parsed.data.symbols ? { symbols: parsed.data.symbols } : {}),
    },
  };
}

function copyReferenceLatex(
  document: TeachingDerivationDocumentV1,
  board: BoardFormulaV1[],
  references: TeachingDerivationStepV1["references"],
): BoardFormulaV1[] {
  const remaining = [...(references ?? [])];
  return board.map((formula) => {
    if (formula.role !== "reference") return formula;
    if (formula.source) {
      const source = document.steps[formula.source.stepIndex - 1]?.board.find(
        (item) => item.key === formula.source!.formulaKey,
      );
      return source ? { ...formula, latex: source.latex } : formula;
    }
    const keyed = remaining.findIndex(
      (item) => item.formulaKey === formula.key,
    );
    const match =
      keyed >= 0 ? remaining.splice(keyed, 1)[0] : remaining.shift();
    if (!match) return formula;
    const prior = document.steps[match.stepIndex - 1];
    const source = prior?.board.find((item) => item.key === match.formulaKey);
    if (!source) return formula;
    return { ...formula, latex: source.latex, source: match };
  });
}

export function validateFinishedDocument(
  document: TeachingDerivationDocumentV1,
): TeachingDerivationIssue[] {
  const issues: TeachingDerivationIssue[] = [];
  if (document.steps.length < 1) {
    issues.push({
      code: "empty_derivation",
      message: "Finish requires at least one committed teaching step.",
    });
  }
  document.steps.forEach((step, index) => {
    issues.push(...teachingVisualIssues(document, step));
    if (step.index !== index + 1) {
      issues.push({
        code: "step_index",
        message: `Committed steps must be contiguous. Expected ${index + 1}, got ${step.index}.`,
      });
    }
  });
  return issues;
}
