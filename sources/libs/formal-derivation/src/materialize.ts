import {
  compileAuthoringTree,
  decompileAuthoringTree,
  reconcileAuthoringTreeIdentity,
  validateDocument,
  type AuthoringTree,
  type FormalDocument,
  type SubjectRef,
} from "../../formal-expression-core/src/index.js";
import { authoringNodeCount } from "./authoring.js";
import { applyBranchCursor } from "./branch.js";
import { DerivationError, revisionConflict } from "./errors.js";
import {
  replaceSubtree,
  setNodeAttribute,
  substituteMany,
  swapSubtrees,
} from "./graft.js";
import { DERIVATION_LIMITS } from "./limits.js";
import { assertValidNotation } from "./notation.js";
import {
  applyPresentation,
  countPresentationTargets,
  emptyPresentationState,
  isObservablePresentation,
} from "./presentation.js";
import {
  applyRegisteredRule,
  maybeEstablishEndpointEquality,
  seedFactsFromRequirement,
} from "./rules.js";
import { parseDerivationDocument } from "./schema.js";
import type {
  CommitDerivationStepArgsV1,
  DerivationActionV1,
  DerivationCheckpointV1,
  DerivationDocumentV1,
  DerivationStepCommitResultV1,
  DerivationStepV1,
  FormulaSeedV1,
  FormulaTransformV1,
  MaterializedDerivationStateV1,
  MaterializedFormulaStateV1,
} from "./types.js";

export function emptyDerivationState(
  facts: string[] = [],
): MaterializedDerivationStateV1 {
  return {
    derivationRevision: 0,
    formulas: {},
    presentation: emptyPresentationState(),
    facts,
    branch: undefined,
  };
}

function cloneState(
  state: MaterializedDerivationStateV1,
): MaterializedDerivationStateV1 {
  return structuredClone(state);
}

function formulaNodeCount(document: FormalDocument): number {
  return Object.keys(document.nodes).length;
}

function compileSeed(seed: FormulaSeedV1): FormalDocument {
  if (authoringNodeCount(seed.tree) > DERIVATION_LIMITS.maxNodesPerFormula) {
    throw new DerivationError({
      code: "limit_exceeded",
      message: `Formula ${seed.id} exceeds ${DERIVATION_LIMITS.maxNodesPerFormula} nodes.`,
      formulaId: seed.id,
    });
  }
  const document = compileAuthoringTree(seed.tree, seed.id);
  document.revision = 1;
  const errors = validateDocument(document);
  if (errors.length) {
    throw new DerivationError({
      code: "formal_invalid",
      message: errors.join("; "),
      formulaId: seed.id,
    });
  }
  if (formulaNodeCount(document) > DERIVATION_LIMITS.maxNodesPerFormula) {
    throw new DerivationError({
      code: "limit_exceeded",
      message: `Formula ${seed.id} exceeds ${DERIVATION_LIMITS.maxNodesPerFormula} nodes.`,
      formulaId: seed.id,
    });
  }
  return document;
}

export function compileInitialFormulas(
  seeds: FormulaSeedV1[],
  facts: string[] = [],
): MaterializedDerivationStateV1 {
  const state = emptyDerivationState(facts);
  const introduced: string[] = [];
  for (const seed of seeds) {
    if (state.formulas[seed.id]) {
      throw new DerivationError({
        code: "duplicate_formula",
        message: `Duplicate formula id ${seed.id}.`,
        formulaId: seed.id,
      });
    }
    state.formulas[seed.id] = {
      revision: 1,
      document: compileSeed(seed),
      display: seed.display,
    };
    introduced.push(seed.id);
  }
  state.presentation = applyPresentation(state.presentation, {}, introduced);
  return state;
}

function ruleIdFromTransform(
  transform: FormulaTransformV1,
  document?: FormalDocument,
  facts: string[] = [],
): string | undefined {
  if (transform.type === "apply_theorem") return transform.theoremId;
  if (
    transform.type === "expand" ||
    transform.type === "simplify" ||
    transform.type === "differentiate" ||
    transform.type === "rewrite_by_definition"
  ) {
    return transform.ruleId;
  }
  if (transform.type === "substitute") {
    const targetValue =
      transform.target.type === "node"
        ? document?.nodes[transform.target.id]?.value
        : undefined;
    const binding =
      transform.binding.kind === "token" ? String(transform.binding.value) : "";
    // These Lagrange substitutions predate explicit rule ids. Infer them only
    // when their semantic preconditions identify the specialized operation;
    // all other substitutions remain valid generic teaching rewrites.
    if (targetValue === "x" && (binding === "a" || binding === "b")) {
      return "substitute_endpoint";
    }
    if (targetValue === "m" && facts.includes("slope_defined")) {
      return "substitute_definition";
    }
  }
  return undefined;
}

function transformTarget(
  transform: FormulaTransformV1,
): SubjectRef | undefined {
  if (transform.type === "apply_theorem") return transform.targets[0];
  return "target" in transform ? transform.target : undefined;
}

function assertRelocatedSubjectsSurvive(
  formulaId: string,
  currentTree: AuthoringTree,
  transform: Extract<FormulaTransformV1, { type: "relocate_subtree" }>,
  nextDocument: FormalDocument,
) {
  if (transform.target.type !== "node") {
    throw new DerivationError({
      code: "invalid_target",
      message: "relocate_subtree requires a node target.",
      formulaId,
    });
  }
  const movingNodeIds = transform.moving.map((subject) => subject.id);
  if (
    transform.moving.length === 0 ||
    transform.moving.length > 8 ||
    new Set(movingNodeIds).size !== movingNodeIds.length
  ) {
    throw new DerivationError({
      code: "invalid_target",
      message: "relocate_subtree requires one to eight distinct moving nodes.",
      formulaId,
    });
  }
  const targetTree = findTreeNode(currentTree, transform.target.id);
  if (!targetTree) {
    throw new DerivationError({
      code: "missing_target",
      message: `Relocation target ${transform.target.id} does not exist in formula ${formulaId}.`,
      formulaId,
    });
  }
  for (const moving of transform.moving) {
    if (moving.type !== "node") {
      throw new DerivationError({
        code: "invalid_target",
        message:
          "relocate_subtree moving subjects must be nodes inside the target subtree.",
        formulaId,
      });
    }
    if (!findTreeNode(targetTree, moving.id)) {
      throw new DerivationError({
        code: "invalid_target",
        message: `Moving node ${moving.id} is not inside relocation target ${transform.target.id}.`,
        formulaId,
      });
    }
    if (!nextDocument.nodes[moving.id]) {
      throw new DerivationError({
        code: "identity_lost",
        message: `relocate_subtree must preserve moving node ${moving.id}; reuse that id in the replacement tree.`,
        formulaId,
        retryable: true,
      });
    }
  }
}

function findTreeNode(
  tree: AuthoringTree,
  id: string,
): AuthoringTree | undefined {
  if (tree.id === id) return tree;
  const children =
    tree.kind === "operator"
      ? tree.operands.map((operand) => operand.node)
      : tree.kind === "container"
        ? tree.slots.map((slot) => slot.node)
        : [];
  for (const child of children) {
    const found = findTreeNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function isBoardStack(
  tree: AuthoringTree,
): tree is Extract<AuthoringTree, { kind: "container" }> {
  return (
    tree.kind === "container" &&
    tree.renderer === "board" &&
    tree.layout?.kind === "stack"
  );
}

/**
 * A board describes simultaneous context (givens or parallel calculations),
 * not a transcript of earlier rewrites. Growing the root board on every step
 * leaves the old equation in place and merely fades in another row, so the
 * learner never sees the formula itself change.
 */
function assertBoardDoesNotAccumulateHistory(
  formulaId: string,
  currentTree: AuthoringTree,
  transform: FormulaTransformV1,
) {
  if (
    (transform.type !== "replace_subtree" &&
      transform.type !== "relocate_subtree") ||
    transform.target.type !== "node" ||
    transform.target.id !== currentTree.id ||
    !isBoardStack(currentTree) ||
    !isBoardStack(transform.replacement) ||
    transform.replacement.slots.length <= currentTree.slots.length
  ) {
    return;
  }
  throw new DerivationError({
    code: "historical_working_rows",
    message: `Formula ${formulaId} cannot append a new row to an existing board during a transform. A board is for simultaneous context or parallel work, not 求导/代入/化简 history. Keep its row count stable and replace the changing working subtree so the learner sees one formula morph; add a genuinely independent result as a new formula.`,
    formulaId,
    retryable: true,
  });
}

function applyTransform(
  state: MaterializedDerivationStateV1,
  formulaId: string,
  transform: FormulaTransformV1,
): {
  document: FormalDocument;
  affectedSubjects: SubjectRef[];
  subjectMap?: Array<{ before: SubjectRef; after: SubjectRef }>;
  validationLevel: "formal" | "rule_checked";
  establishedFacts: string[];
} {
  const formula = state.formulas[formulaId];
  if (!formula) {
    throw new DerivationError({
      code: "missing_formula",
      message: `Formula ${formulaId} does not exist.`,
      formulaId,
    });
  }
  const ruleId = ruleIdFromTransform(transform, formula.document, state.facts);
  let establishedFacts: string[] = [];
  let validationLevel: "formal" | "rule_checked" = "formal";
  if (ruleId) {
    const applied = applyRegisteredRule({
      ruleId,
      transform,
      formulaId,
      document: formula.document,
      target: transformTarget(transform),
      state,
    });
    validationLevel = applied.validationLevel;
    establishedFacts = applied.establishedFacts ?? [];
    if (applied.replacement && transform.type !== "replace_subtree") {
      const grafted = replaceSubtree(
        formula.document,
        transformTarget(transform) ?? {
          type: "node",
          id: formula.document.roots[0]!,
        },
        applied.replacement,
      );
      return {
        ...grafted,
        validationLevel,
        establishedFacts,
      };
    }
  }
  if (transform.type === "replace_subtree") {
    return {
      ...replaceSubtree(
        formula.document,
        transform.target,
        transform.replacement,
      ),
      validationLevel: "formal",
      establishedFacts,
    };
  }
  if (transform.type === "relocate_subtree") {
    const currentTree = decompileAuthoringTree(formula.document);
    const grafted = replaceSubtree(
      formula.document,
      transform.target,
      transform.replacement,
    );
    assertRelocatedSubjectsSurvive(
      formulaId,
      currentTree,
      transform,
      grafted.document,
    );
    return {
      ...grafted,
      validationLevel: "formal",
      establishedFacts,
    };
  }
  if (transform.type === "swap_subtrees") {
    return {
      ...swapSubtrees(formula.document, transform.left, transform.right),
      validationLevel: "formal",
      establishedFacts,
    };
  }
  if (transform.type === "substitute") {
    return {
      ...replaceSubtree(formula.document, transform.target, transform.binding),
      validationLevel,
      establishedFacts,
    };
  }
  if (transform.type === "substitute_many") {
    return {
      ...substituteMany(formula.document, transform.substitutions),
      validationLevel: "formal",
      establishedFacts,
    };
  }
  if (transform.type === "apply_theorem") {
    return {
      document: formula.document,
      affectedSubjects: transform.targets,
      validationLevel,
      establishedFacts,
    };
  }
  return {
    document: {
      ...structuredClone(formula.document),
      revision: formula.document.revision + 1,
    },
    affectedSubjects: transformTarget(transform)
      ? [transformTarget(transform)!]
      : [],
    validationLevel,
    establishedFacts,
  };
}

function applyAction(
  state: MaterializedDerivationStateV1,
  action: DerivationActionV1,
  stepId: string,
  extraRuleIds: string[],
  enforceAuthoringPolicy: boolean,
): {
  formulaId?: string;
  beforeRevision?: number;
  afterRevision?: number;
  affectedSubjects: SubjectRef[];
  subjectMap?: Array<{ before: SubjectRef; after: SubjectRef }>;
  introduced?: string;
  validationLevel: "formal" | "rule_checked";
} {
  if (action.type === "formula.add") {
    if (state.formulas[action.formula.id]) {
      throw new DerivationError({
        code: "duplicate_formula",
        message: `Duplicate formula id ${action.formula.id}.`,
        formulaId: action.formula.id,
      });
    }
    const document = compileSeed(action.formula);
    const provenance = action.provenance
      ? {
          formulaId: action.formula.id,
          atStepId: stepId,
          ...action.provenance,
        }
      : undefined;
    state.formulas[action.formula.id] = {
      revision: document.revision,
      document,
      display: action.formula.display,
      provenance,
    };
    const established: string[] = [];
    for (const ruleId of extraRuleIds) {
      const applied = applyRegisteredRule({
        ruleId,
        formulaId: action.formula.id,
        document,
        state,
      });
      established.push(...(applied.establishedFacts ?? []));
    }
    if (established.length)
      state.facts = [...new Set([...state.facts, ...established])];
    return {
      formulaId: action.formula.id,
      afterRevision: document.revision,
      affectedSubjects: document.roots.map((id) => ({
        type: "node" as const,
        id,
      })),
      introduced: action.formula.id,
      validationLevel: extraRuleIds.length ? "rule_checked" : "formal",
    };
  }
  if (action.type === "formula.set_metadata") {
    const formula = state.formulas[action.formulaId];
    if (!formula) {
      throw new DerivationError({
        code: "missing_formula",
        message: `Formula ${action.formulaId} does not exist.`,
        formulaId: action.formulaId,
      });
    }
    formula.display = { ...formula.display, ...action.patch };
    return {
      formulaId: action.formulaId,
      beforeRevision: formula.revision,
      afterRevision: formula.revision,
      affectedSubjects: [],
      validationLevel: "formal",
    };
  }
  if (action.type === "subject.set_attribute") {
    const formula = state.formulas[action.formulaId];
    if (!formula) {
      throw new DerivationError({
        code: "missing_formula",
        message: `Formula ${action.formulaId} does not exist.`,
        formulaId: action.formulaId,
      });
    }
    if (action.baseFormulaRevision !== formula.revision) {
      throw revisionConflict(
        "formula",
        action.baseFormulaRevision,
        formula.revision,
      );
    }
    const next = setNodeAttribute(
      formula.document,
      action.subject,
      action.key,
      action.value,
    );
    const errors = validateDocument(next);
    if (errors.length) {
      throw new DerivationError({
        code: "formal_invalid",
        message: errors.join("; "),
        formulaId: action.formulaId,
      });
    }
    formula.document = next;
    formula.revision = next.revision;
    if (action.key === "nonzero" && action.value === true) {
      state.facts = [...new Set([...state.facts, "b_minus_a_nonzero"])];
    }
    return {
      formulaId: action.formulaId,
      beforeRevision: action.baseFormulaRevision,
      afterRevision: next.revision,
      affectedSubjects: [action.subject],
      validationLevel: "formal",
    };
  }
  const formula = state.formulas[action.formulaId];
  if (!formula) {
    throw new DerivationError({
      code: "missing_formula",
      message: `Formula ${action.formulaId} does not exist.`,
      formulaId: action.formulaId,
    });
  }
  if (action.baseFormulaRevision !== formula.revision) {
    throw revisionConflict(
      "formula",
      action.baseFormulaRevision,
      formula.revision,
    );
  }
  if (enforceAuthoringPolicy) {
    assertBoardDoesNotAccumulateHistory(
      action.formulaId,
      decompileAuthoringTree(formula.document),
      action.transform,
    );
  }
  const result = applyTransform(state, action.formulaId, action.transform);
  const errors = validateDocument(result.document);
  if (errors.length) {
    throw new DerivationError({
      code: "formal_invalid",
      message: errors.join("; "),
      formulaId: action.formulaId,
    });
  }
  if (
    formulaNodeCount(result.document) > DERIVATION_LIMITS.maxNodesPerFormula
  ) {
    throw new DerivationError({
      code: "limit_exceeded",
      message: `Formula ${action.formulaId} exceeds ${DERIVATION_LIMITS.maxNodesPerFormula} nodes.`,
      formulaId: action.formulaId,
    });
  }
  formula.document = result.document;
  formula.revision = result.document.revision;
  if (result.establishedFacts.length) {
    state.facts = [...new Set([...state.facts, ...result.establishedFacts])];
  }
  return {
    formulaId: action.formulaId,
    beforeRevision: action.baseFormulaRevision,
    afterRevision: result.document.revision,
    affectedSubjects: result.affectedSubjects,
    subjectMap: result.subjectMap,
    validationLevel: result.validationLevel,
  };
}

export function applyDerivationStep(
  state: MaterializedDerivationStateV1,
  step: DerivationStepV1,
  options: { enforceAuthoringPolicy?: boolean } = {},
): {
  state: MaterializedDerivationStateV1;
  result: DerivationStepCommitResultV1;
} {
  if (step.baseRevision !== state.derivationRevision) {
    throw revisionConflict(
      "derivation",
      step.baseRevision,
      state.derivationRevision,
    );
  }
  if (step.actions.length > DERIVATION_LIMITS.maxActionsPerStep) {
    throw new DerivationError({
      code: "limit_exceeded",
      message: `A step may contain at most ${DERIVATION_LIMITS.maxActionsPerStep} actions.`,
      stepId: step.id,
    });
  }
  if (
    countPresentationTargets(step.presentation) >
    DERIVATION_LIMITS.maxFocusHighlightTargets
  ) {
    throw new DerivationError({
      code: "limit_exceeded",
      message: `A step may focus/highlight at most ${DERIVATION_LIMITS.maxFocusHighlightTargets} targets.`,
      stepId: step.id,
    });
  }
  if (
    step.actions.length === 0 &&
    !isObservablePresentation(step.presentation)
  ) {
    throw new DerivationError({
      code: "empty_step",
      message: "A step needs actions or an observable presentation change.",
      stepId: step.id,
    });
  }
  const introducedInStep = step.actions.filter(
    (action) => action.type === "formula.add",
  );
  if (
    introducedInStep.length > DERIVATION_LIMITS.maxFormulasIntroducedPerStep
  ) {
    throw new DerivationError({
      code: "limit_exceeded",
      message: `A step may introduce at most ${DERIVATION_LIMITS.maxFormulasIntroducedPerStep} formulas.`,
      stepId: step.id,
    });
  }
  const next = cloneState(state);
  const transitions: DerivationStepCommitResultV1["formulaTransitions"] = [];
  const introduced: string[] = [];
  try {
    for (const action of step.actions) {
      const applied = applyAction(
        next,
        action,
        step.id,
        step.metadata?.ruleIds ?? [],
        options.enforceAuthoringPolicy === true,
      );
      if (applied.introduced) introduced.push(applied.introduced);
      if (applied.formulaId && applied.afterRevision != null) {
        transitions.push({
          formulaId: applied.formulaId,
          beforeRevision: applied.beforeRevision,
          afterRevision: applied.afterRevision,
          affectedSubjects: applied.affectedSubjects,
          subjectMap: applied.subjectMap,
          validationLevel: applied.validationLevel,
        });
      }
    }
  } catch (error) {
    throw error;
  }
  next.presentation = applyPresentation(
    next.presentation,
    step.presentation,
    introduced,
  );
  next.branch = applyBranchCursor(state.branch, step.branch, step.id);
  next.derivationRevision = step.afterRevision;
  next.currentStepId = step.id;
  const extraFacts = maybeEstablishEndpointEquality(next);
  if (extraFacts.length)
    next.facts = [...new Set([...next.facts, ...extraFacts])];
  return {
    state: next,
    result: {
      derivationRevision: next.derivationRevision,
      stepId: step.id,
      formulaTransitions: transitions,
      presentation: next.presentation,
    },
  };
}

export function commitDerivationStep(
  state: MaterializedDerivationStateV1,
  args: CommitDerivationStepArgsV1,
): {
  step: DerivationStepV1;
  state: MaterializedDerivationStateV1;
  result: DerivationStepCommitResultV1;
} {
  const ordinal = state.derivationRevision + 1;
  if (ordinal > DERIVATION_LIMITS.maxStepsPerRun) {
    throw new DerivationError({
      code: "limit_exceeded",
      message: `A run may commit at most ${DERIVATION_LIMITS.maxStepsPerRun} steps.`,
    });
  }
  const stepId = args.stepId ?? `step-${ordinal}`;
  const canonicalState = cloneState(state);
  const canonicalActions: DerivationActionV1[] = [];
  for (const sourceAction of args.actions) {
    let action = structuredClone(sourceAction);
    if (
      action.type === "formula.transform" &&
      (action.transform.type === "replace_subtree" ||
        action.transform.type === "relocate_subtree") &&
      action.transform.target.type === "node"
    ) {
      const formula = canonicalState.formulas[action.formulaId];
      if (formula?.document.nodes[action.transform.target.id]) {
        action = {
          ...action,
          transform: {
            ...action.transform,
            replacement: reconcileAuthoringTreeIdentity(
              decompileAuthoringTree(
                formula.document,
                action.transform.target.id,
              ),
              action.transform.replacement,
              { rootId: action.transform.target.id },
            ),
          },
        };
      }
    }
    applyAction(canonicalState, action, stepId, args.ruleIds ?? [], true);
    canonicalActions.push(action);
  }
  const step: DerivationStepV1 = {
    id: stepId,
    ordinal,
    baseRevision: args.baseRevision,
    afterRevision: state.derivationRevision + 1,
    kind: args.kind ?? "teaching",
    actions: canonicalActions,
    presentation: args.presentation,
    branch: args.branch,
    metadata: {
      source: args.source ?? "agent",
      toolCallId: args.toolCallId,
      ruleIds: args.ruleIds,
      summary: args.summary,
    },
  };
  const applied = applyDerivationStep(state, step);
  for (const transition of applied.result.formulaTransitions) {
    const formula = applied.state.formulas[transition.formulaId];
    if (!formula) continue;
    assertValidNotation(
      decompileAuthoringTree(formula.document),
      transition.formulaId,
    );
  }
  return { step, state: applied.state, result: applied.result };
}

export function replayDerivation(
  document: DerivationDocumentV1,
  options: {
    throughOrdinal?: number;
    throughRevision?: number;
    checkpoints?: DerivationCheckpointV1[];
  } = {},
): MaterializedDerivationStateV1 {
  const parsed =
    document.schemaVersion === 1 ? document : parseDerivationDocument(document);
  const facts = seedFactsFromRequirement(
    parsed.requirement.text,
    parsed.requirement.assumptions,
  );
  const throughOrdinal =
    options.throughOrdinal ??
    (options.throughRevision != null
      ? options.throughRevision
      : parsed.steps.length);
  const checkpoint = [...(options.checkpoints ?? [])]
    .filter((item) => item.stepOrdinal <= throughOrdinal)
    .sort((left, right) => right.stepOrdinal - left.stepOrdinal)[0];
  let state = checkpoint
    ? structuredClone(checkpoint.state)
    : compileInitialFormulas(parsed.initialFormulas, facts);
  const startOrdinal = checkpoint?.stepOrdinal ?? 0;
  for (const step of parsed.steps) {
    if (step.ordinal <= startOrdinal) continue;
    if (step.ordinal > throughOrdinal) break;
    if (
      options.throughRevision != null &&
      step.afterRevision > options.throughRevision
    ) {
      break;
    }
    state = applyDerivationStep(state, step).state;
  }
  return state;
}

export function materializeAtStep(
  document: DerivationDocumentV1,
  stepOrdinal: number,
  checkpoints?: DerivationCheckpointV1[],
): MaterializedDerivationStateV1 {
  return replayDerivation(document, {
    throughOrdinal: stepOrdinal,
    checkpoints,
  });
}

export function createCheckpoint(
  state: MaterializedDerivationStateV1,
  stepOrdinal: number,
): DerivationCheckpointV1 {
  return {
    stepOrdinal,
    revision: state.derivationRevision,
    state: structuredClone(state),
  };
}

export function shouldCheckpoint(ordinal: number): boolean {
  return ordinal > 0 && ordinal % DERIVATION_LIMITS.checkpointInterval === 0;
}

export function unresolvedPlaceholders(
  state: MaterializedDerivationStateV1,
): Array<{ formulaId: string; nodeId: string }> {
  const found: Array<{ formulaId: string; nodeId: string }> = [];
  for (const [formulaId, formula] of Object.entries(state.formulas)) {
    for (const [nodeId, node] of Object.entries(formula.document.nodes)) {
      if (node.kind === "placeholder") found.push({ formulaId, nodeId });
    }
  }
  return found;
}

export function inspectFormulaTree(
  formulaId: string,
  document: FormalDocument,
) {
  return {
    formulaId,
    revision: document.revision,
    rootId: document.roots[0],
    nodeIds: Object.keys(document.nodes),
    tree: decompileAuthoringTree(document),
  };
}

export function isPresentationOnlyStep(
  step: Pick<DerivationStepV1, "actions">,
): boolean {
  return step.actions.length === 0;
}
