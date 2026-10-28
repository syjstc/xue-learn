import type {
  AuthoringTree,
  FormalDocument,
  JsonValue,
  SubjectRef,
} from "../../formal-expression-core/src/index.js";
import { DERIVATION_SCHEMA_VERSION } from "./limits.js";

export type DerivationSubjectRef =
  | { type: "formula"; formulaId: string }
  | {
      type: "subject";
      formulaId: string;
      subject: SubjectRef;
    };

export type FormulaDisplayRoleV1 =
  "definition" | "assumption" | "working" | "theorem" | "result" | "reference";

export interface FormulaDisplayMetadataV1 {
  role?: FormulaDisplayRoleV1;
  caption?: string;
  /** Keep an established formula visible as compact context for later steps. */
  pinned?: boolean;
}

export interface FormulaSeedV1 {
  id: string;
  label?: string;
  tree: AuthoringTree;
  display?: FormulaDisplayMetadataV1;
}

export interface FormulaProvenanceV1 {
  formulaId: string;
  derivedFromFormulaId: string;
  atStepId: string;
  kind: "copy" | "specialize" | "consequence" | "reference";
  subjectMap?: Array<{
    from: SubjectRef;
    to: SubjectRef;
  }>;
}

export type FormulaTransformV1 =
  | { type: "replace_subtree"; target: SubjectRef; replacement: AuthoringTree }
  | {
      /**
       * Rewrite the smallest common ancestor while keeping the listed existing
       * nodes alive. This is the motion-first form of moving a term across an
       * operator or equality: the surrounding structure may change, but the
       * moved glyphs must travel instead of being recreated.
       */
      type: "relocate_subtree";
      target: SubjectRef;
      replacement: AuthoringTree;
      moving: SubjectRef[];
    }
  | { type: "swap_subtrees"; left: SubjectRef; right: SubjectRef }
  | { type: "substitute"; target: SubjectRef; binding: AuthoringTree }
  | {
      /** Apply several independent substitutions atomically as one revision. */
      type: "substitute_many";
      substitutions: Array<{ target: SubjectRef; binding: AuthoringTree }>;
    }
  | { type: "expand"; target: SubjectRef; ruleId: string }
  | { type: "simplify"; target: SubjectRef; ruleId: string }
  | {
      type: "differentiate";
      target: SubjectRef;
      variable: string;
      ruleId: string;
    }
  | { type: "rewrite_by_definition"; target: SubjectRef; ruleId: string }
  | { type: "apply_theorem"; theoremId: string; targets: SubjectRef[] };

export type DerivationActionV1 =
  | {
      type: "formula.add";
      formula: FormulaSeedV1;
      provenance?: Omit<FormulaProvenanceV1, "formulaId" | "atStepId">;
    }
  | {
      type: "formula.transform";
      formulaId: string;
      baseFormulaRevision: number;
      transform: FormulaTransformV1;
    }
  | {
      type: "formula.set_metadata";
      formulaId: string;
      patch: Partial<FormulaDisplayMetadataV1>;
    }
  | {
      type: "subject.set_attribute";
      formulaId: string;
      baseFormulaRevision: number;
      subject: SubjectRef;
      key: string;
      value: JsonValue;
    };

export interface DerivationPresentationV1 {
  narration?: Array<{
    id: string;
    text: string;
    related?: DerivationSubjectRef[];
  }>;
  formulaVisibility?: Array<{
    formulaId: string;
    state: "visible" | "hidden";
  }>;
  focus?: DerivationSubjectRef[];
  highlight?: Array<{
    subject: DerivationSubjectRef;
    tone: "primary" | "success" | "warning" | "danger" | "muted";
    emphasis: "soft" | "strong";
  }>;
  dimOthers?: boolean;
  pauseMs?: number;
}

export type DerivationBranchRoleV1 = "split" | "case" | "join";

export interface DerivationCaseDeclV1 {
  id: string;
  label: string;
  assumption?: string;
}

/** Logical case grouping on a still-linear teaching timeline. Not a DAG. */
export interface DerivationBranchV1 {
  role: DerivationBranchRoleV1;
  splitId: string;
  caseId?: string;
  label?: string;
  assumption?: string;
  cases?: DerivationCaseDeclV1[];
}

export interface MaterializedBranchCursorV1 {
  splitId: string;
  label?: string;
  cases: DerivationCaseDeclV1[];
  currentCaseId?: string;
  startedCaseIds: string[];
}

export interface DerivationExpansionMetaV1 {
  expansionId: string;
  replacesStepId: string;
  index: number;
  count: number;
  depth: number;
}

export interface DerivationStepMetadataV1 {
  source: "agent" | "admin" | "migration";
  toolCallId?: string;
  ruleIds?: string[];
  summary?: string;
  expansion?: DerivationExpansionMetaV1;
  supersededByExpansionId?: string;
}

export type DerivationTimelineItemV1 =
  | { type: "step"; step: DerivationStepV1 }
  | {
      type: "expansion";
      expansionId: string;
      replacesStepId: string;
      steps: DerivationStepV1[];
    }
  | {
      type: "split";
      splitId: string;
      label?: string;
      splitStep: DerivationStepV1;
      cases: Array<{
        id: string;
        label: string;
        assumption?: string;
        steps: DerivationStepV1[];
      }>;
      joinStep?: DerivationStepV1;
    };

export interface DerivationStepV1 {
  id: string;
  ordinal: number;
  baseRevision: number;
  afterRevision: number;
  kind: "teaching" | "summary";
  actions: DerivationActionV1[];
  presentation: DerivationPresentationV1;
  branch?: DerivationBranchV1;
  metadata?: DerivationStepMetadataV1;
}

export interface DerivationCompletionV1 {
  validatedRevision: number;
  validationLevel: "formal" | "rule_checked";
  summary: string;
  completedAt: string;
}

export interface DerivationRequirementV1 {
  text: string;
  assumptions?: string[];
  target?: string;
}

export interface DerivationDocumentV1 {
  schemaVersion: typeof DERIVATION_SCHEMA_VERSION;
  id: string;
  title: string;
  locale: string;
  revision: number;
  status: "draft" | "complete" | "failed";
  requirement: DerivationRequirementV1;
  initialFormulas: FormulaSeedV1[];
  steps: DerivationStepV1[];
  /** Original steps replaced by an expansion; not part of playback. */
  archivedSteps?: DerivationStepV1[];
  completion?: DerivationCompletionV1;
}

export interface MaterializedPresentationStateV1 {
  visibleFormulaIds: string[];
  narration: DerivationPresentationV1["narration"];
  focus: DerivationSubjectRef[];
  highlight: NonNullable<DerivationPresentationV1["highlight"]>;
  dimOthers: boolean;
  pauseMs?: number;
}

export interface MaterializedFormulaStateV1 {
  revision: number;
  document: FormalDocument;
  display?: FormulaDisplayMetadataV1;
  provenance?: FormulaProvenanceV1;
}

export interface MaterializedDerivationStateV1 {
  derivationRevision: number;
  currentStepId?: string;
  formulas: Record<string, MaterializedFormulaStateV1>;
  presentation: MaterializedPresentationStateV1;
  facts: string[];
  branch?: MaterializedBranchCursorV1;
}

export interface DerivationStepCommitResultV1 {
  derivationRevision: number;
  stepId: string;
  formulaTransitions: Array<{
    formulaId: string;
    beforeRevision?: number;
    afterRevision: number;
    affectedSubjects: SubjectRef[];
    subjectMap?: Array<{ before: SubjectRef; after: SubjectRef }>;
    validationLevel: "formal" | "rule_checked";
  }>;
  presentation: MaterializedPresentationStateV1;
}

export interface CommitDerivationStepArgsV1 {
  baseRevision: number;
  summary: string;
  actions: DerivationActionV1[];
  presentation: DerivationPresentationV1;
  branch?: DerivationBranchV1;
  kind?: DerivationStepV1["kind"];
  source?: DerivationStepMetadataV1["source"];
  toolCallId?: string;
  ruleIds?: string[];
  stepId?: string;
}

export interface ValidationFindingV1 {
  level: "schema" | "formal" | "mathematical";
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  stepId?: string;
  formulaId?: string;
}

export interface DerivationCheckpointV1 {
  stepOrdinal: number;
  revision: number;
  state: MaterializedDerivationStateV1;
}

export interface LearnerSafeRunErrorV1 {
  code: string;
  message: string;
  retryable: boolean;
}

export type FormalDerivationRunStatusV1 =
  | "draft"
  | "running"
  | "validating"
  | "complete"
  | "needs_attention"
  | "cancelled"
  | "failed";

export type FormalDerivationRunEventV1 =
  | { type: "run_started"; runId: string }
  | { type: "agent_message"; message: string }
  | {
      type: "tool_started";
      toolCallId: string;
      toolName: string;
      args?: unknown;
    }
  | { type: "step_committed"; step: DerivationStepV1 }
  | { type: "tool_finished"; toolCallId: string; ok: boolean; result?: unknown }
  | { type: "validation_completed"; findings: ValidationFindingV1[] }
  | { type: "run_completed"; revision: number }
  | { type: "run_cancelled" }
  | { type: "run_failed"; error: LearnerSafeRunErrorV1 }
  | {
      type: "expansion_started";
      expansionId: string;
      stepId: string;
    }
  | {
      type: "expansion_completed";
      expansionId: string;
      insertedCount: number;
      revision: number;
    }
  | { type: "expansion_collapsed"; expansionId: string; revision: number };
