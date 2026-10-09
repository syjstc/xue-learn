import type { TeachingTarget, TeachingCue, TeachingIntent, TeachingPresentationPlan } from "./teaching-plan.js";
import type { TeachingVisualAssetV1, TeachingVisualDisplayV1, TeachingVisualV1 } from "./visual.js";
import type {
  FormulaAnalysis,
  FormulaAnimationStatus,
  FormulaCorrespondence,
  FormulaSyntaxStatus,
  FormulaTransition,
  SymbolDeclaration,
} from "../../formula-analysis/src/index.js";

export const TEACHING_DERIVATION_SCHEMA_VERSION = 1 as const;
export const TEACHING_DERIVATION_FORMAT = "teaching_v1" as const;
export const CLASSIC_DERIVATION_FORMAT = "classic" as const;

export type DerivationFormat = "classic" | "teaching_v1";

export const TEACHING_RELATIONS = [
  "introduce",
  "equivalence",
  "imply",
  "substitute",
  "case_split",
  "narrate_only",
] as const;
export type TeachingRelation = (typeof TEACHING_RELATIONS)[number];

export type BoardFormulaRole = "primary" | "reference";

export type BoardFormulaV1 = Readonly<{
  key: string;
  title: string;
  latex: string;
  role: BoardFormulaRole;
  change?: "introduce" | "transform" | "hold";
  source?: StepReferenceV1;
}>;

export type StepReferenceV1 = Readonly<{
  stepIndex: number;
  formulaKey: string;
}>;

export type TeachingDerivationStepV1 = Readonly<{
  index: number;
  board: readonly BoardFormulaV1[];
  relation: TeachingRelation;
  references?: readonly StepReferenceV1[];
  conditions?: string;
  justification: string;
  narration: string;
  presentationFallback?: string;
  focusFormulaKey: string;
  /** Only premises relevant to this step. Full section givens stay intact. */
  givenIndexes?: readonly number[];
  visual?: TeachingVisualV1;
  targets?: readonly TeachingTarget[];
  cues?: readonly TeachingCue[];
  intents?: readonly TeachingIntent[];
}>;

export type TeachingDerivationDocumentV1 = Readonly<{
  schemaVersion: typeof TEACHING_DERIVATION_SCHEMA_VERSION;
  id: string;
  title: string;
  locale: string;
  lineageBackup?: readonly TeachingDerivationStepV1[];
  presentationBackup?: readonly Pick<TeachingDerivationStepV1, "index" | "targets" | "cues" | "intents">[];
  teachingGoal: string;
  givens: readonly string[];
  symbols?: readonly SymbolDeclaration[];
  /** Host-owned accepted support catalog, frozen before provider work. */
  visualAssets?: readonly TeachingVisualAssetV1[];
  visualDisplays?: readonly TeachingVisualDisplayV1[];
  steps: readonly TeachingDerivationStepV1[];
  summary?: string;
  status: "draft" | "complete";
  revision: number;
}>;

export type FormulaStatuses = Readonly<{
  syntaxStatus: FormulaSyntaxStatus;
  analysisStatus: FormulaAnalysis["analysisStatus"];
  mathVerification: "not_checked";
  animationStatus: FormulaAnimationStatus;
}>;

export type TeachingFormulaDerivedV1 = Readonly<{
  key: string;
  analysis: FormulaAnalysis;
  statuses: FormulaStatuses;
}>;

export type TeachingStepTransitionV1 = Readonly<{
  formulaKey: string;
  correspondence: FormulaCorrespondence;
  transition: FormulaTransition;
}>;

export type TeachingStepDerivedV1 = Readonly<{
  index: number;
  formulas: readonly TeachingFormulaDerivedV1[];
  transitions: readonly TeachingStepTransitionV1[];
  presentation?: TeachingPresentationPlan;
}>;

export type TeachingDerivationDerivedV1 = Readonly<{
  presentationVersion?: string;
  documentHash?: string;
  parserVersion: string;
  analyzerVersion: string;
  matcherVersion: string;
  compilerVersion: string;
  steps: readonly TeachingStepDerivedV1[];
}>;

export const TEACHING_DERIVATION_STEP_LIMIT = 80;
export const TEACHING_DERIVATION_STEP_REPAIR_LIMIT = 3;
