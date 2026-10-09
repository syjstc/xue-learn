import {
  decompileAuthoringTree,
  speakAuthoringTree,
} from "../../formal-expression-core/src/index.js";
import {
  applyDerivationStep,
  compileInitialFormulas,
} from "./materialize.js";
import { parseDerivationDocument } from "./schema.js";
import { seedFactsFromRequirement } from "./rules.js";
import type { DerivationDocumentV1, DerivationStepV1 } from "./types.js";

function fallbackNarrationLines(document: unknown): string[][] {
  if (!document || typeof document !== "object") return [];
  const steps = (document as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => narrationTexts(step));
}

function narrationTexts(step: unknown): string[] {
  if (!step || typeof step !== "object") return [];
  const presentation = (step as { presentation?: unknown }).presentation;
  if (!presentation || typeof presentation !== "object") return [];
  const narration = (presentation as { narration?: unknown }).narration;
  if (!Array.isArray(narration)) return [];
  return narration
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? speakTeacherNarration(text) : "";
    })
    .filter(Boolean);
}

/**
 * New 讲解 is authored as spoken classroom Chinese. This only strips leftover
 * markdown/TeX fences so MiniMax does not read dollar signs; it does not map
 * formula glyphs.
 */
export function speakTeacherNarration(text: string): string {
  return text
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function changedFormulaIds(step: DerivationStepV1): string[] {
  const ids: string[] = [];
  for (const action of step.actions) {
    if (action.type === "formula.add") ids.push(action.formula.id);
    if (action.type === "formula.transform") ids.push(action.formulaId);
  }
  return [...new Set(ids)];
}

function linesForAppliedStep(
  step: DerivationStepV1,
  formulas: Record<
    string,
    { document: Parameters<typeof decompileAuthoringTree>[0] }
  >,
): string[] {
  const spokenFormulas = changedFormulaIds(step)
    .map((formulaId) => {
      const formula = formulas[formulaId];
      if (!formula) return "";
      try {
        return speakAuthoringTree(decompileAuthoringTree(formula.document));
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const narration = (step.presentation.narration ?? [])
    .map((item) => speakTeacherNarration(item.text))
    .filter(Boolean);
  return [...spokenFormulas, ...narration];
}

/**
 * One classroom beat list per derivation step: standardized formula reading
 * (when the step adds or transforms a formula), then that step's 讲解.
 */
export function spokenTeacherLinesForDerivationSteps(
  document: unknown,
): readonly (readonly string[])[] {
  const fallback = fallbackNarrationLines(document);
  let parsed: DerivationDocumentV1;
  try {
    parsed = parseDerivationDocument(document);
  } catch {
    return fallback;
  }
  try {
    const facts = seedFactsFromRequirement(
      parsed.requirement.text,
      parsed.requirement.assumptions,
    );
    let state = compileInitialFormulas(parsed.initialFormulas, facts);
    const byStep: string[][] = [];
    for (const step of parsed.steps) {
      const applied = applyDerivationStep(state, step);
      state = applied.state;
      const lines = linesForAppliedStep(step, state.formulas);
      byStep.push(lines.length ? lines : fallback[byStep.length] ?? []);
    }
    return byStep;
  } catch {
    return fallback;
  }
}
