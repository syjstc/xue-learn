import { randomUUID } from "node:crypto";
import { decompileAuthoringTree } from "../../../../../formal-expression-core/src/index.js";
import type {
  FormalDerivationRepository,
  FormalDerivationRunStatus,
} from "../../../../../domain/src/index.js";
import {
  canonicalizeNotationTree,
  compactDerivationInspect,
  commitDerivationStep,
  createCheckpoint,
  DerivationError,
  parseCommitDerivationStepArgs,
  parseDerivationDocument,
  replayDerivation,
  shouldCheckpoint,
  spliceExpansion,
  collapseExpansion,
  canExpandDerivationStep,
  DERIVATION_LIMITS,
  validateDerivationDocument,
  type CommitDerivationStepArgsV1,
  type DerivationCheckpointV1,
  type DerivationDocumentV1,
  type FormalDerivationRunEventV1,
  type ValidationFindingV1,
} from "../../../../../formal-derivation/src/index.js";
import { requireFormalDerivationPersistence } from "./persistence.js";

type ToolFailure = {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  expectedRevision?: number;
  actualRevision?: number;
  formulaId?: string;
  stepId?: string;
};

function fail(error: DerivationError | ToolFailure | Error): ToolFailure {
  if (error instanceof DerivationError) return error.toJSON();
  if ("ok" in error && error.ok === false) return error;
  return {
    ok: false,
    code: "internal_error",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function parseDocument(json: string): DerivationDocumentV1 {
  return parseDerivationDocument(JSON.parse(json) as unknown);
}

function parseCheckpoints(
  records: ReadonlyArray<{
    stepOrdinal: number;
    revision: number;
    stateJson: string;
  }>,
): DerivationCheckpointV1[] {
  return records.map((record) => ({
    stepOrdinal: record.stepOrdinal,
    revision: record.revision,
    state: JSON.parse(record.stateJson) as DerivationCheckpointV1["state"],
  }));
}

export async function emitFormalDerivationEvent(
  runId: string,
  event: FormalDerivationRunEventV1,
  repository: FormalDerivationRepository = requireFormalDerivationPersistence(),
): Promise<{ sequence: number }> {
  const stored = await repository.appendEvent({
    runId,
    eventJson: JSON.stringify(event),
    now: new Date(),
  });
  return { sequence: stored.sequence };
}

export async function inspectDerivationForRun(runId: string) {
  const repository = requireFormalDerivationPersistence();
  const run = await repository.getRun(runId);
  if (!run) {
    return fail({
      ok: false,
      code: "not_found",
      message: "Derivation run was not found.",
      retryable: false,
    });
  }
  const document = parseDocument(run.documentJson);
  return {
    ok: true as const,
    status: run.status,
    ...compactDerivationInspect(document),
  };
}

// Return only changed formulas, using the actual post-normalization state. The
// agent can merge this delta into its last inspection without another LLM turn.
function commitContinuation(
  committed: ReturnType<typeof commitDerivationStep>,
  stepCount: number,
) {
  const changed = new Set(
    committed.step.actions.map((action) =>
      action.type === "formula.add" ? action.formula.id : action.formulaId,
    ),
  );
  return {
    derivationRevision: committed.state.derivationRevision,
    currentStepId: committed.step.id,
    remainingSteps: Math.max(0, DERIVATION_LIMITS.maxStepsPerRun - stepCount),
    branch: committed.state.branch ?? null,
    facts: committed.state.facts,
    presentation: committed.state.presentation,
    formulas: [...changed].map((formulaId) => {
      const formula = committed.state.formulas[formulaId]!;
      return {
        formulaId,
        revision: formula.revision,
        display: formula.display,
        provenance: formula.provenance,
        tree: decompileAuthoringTree(formula.document),
      };
    }),
  };
}

export async function commitDerivationStepForRun(
  runId: string,
  rawArgs: unknown,
  toolCallId?: string,
) {
  const repository = requireFormalDerivationPersistence();
  const run = await repository.getRun(runId);
  if (!run) {
    return fail({
      ok: false,
      code: "not_found",
      message: "Derivation run was not found.",
      retryable: false,
    });
  }
  if (run.status === "cancelled" || run.status === "complete") {
    return fail({
      ok: false,
      code: "run_immutable",
      message: `Run status ${run.status} does not accept new steps.`,
      retryable: false,
    });
  }
  let args: CommitDerivationStepArgsV1;
  try {
    args = parseCommitDerivationStepArgs(rawArgs);
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
  const document = parseDocument(run.documentJson);
  try {
    const committed = commitDerivationStep(replayDerivation(document), {
      ...args,
      source: args.source ?? "agent",
      toolCallId: toolCallId ?? args.toolCallId,
    });
    const nextDocument: DerivationDocumentV1 = {
      ...document,
      steps: [...document.steps, committed.step],
      revision: committed.state.derivationRevision,
    };
    const checkpoint = shouldCheckpoint(committed.step.ordinal)
      ? createCheckpoint(committed.state, committed.step.ordinal)
      : undefined;
    const persisted = await repository.appendStep({
      runId,
      expectedRevision: args.baseRevision,
      documentJson: JSON.stringify(nextDocument),
      revision: nextDocument.revision,
      step: {
        id: committed.step.id,
        runId,
        ordinal: committed.step.ordinal,
        baseRevision: committed.step.baseRevision,
        afterRevision: committed.step.afterRevision,
        kind: committed.step.kind,
        actionsJson: JSON.stringify(committed.step.actions),
        presentationJson: JSON.stringify(committed.step.presentation),
        metadataJson: JSON.stringify(committed.step.metadata ?? {}),
      },
      checkpoint: checkpoint
        ? {
            id: randomUUID(),
            runId,
            stepOrdinal: checkpoint.stepOrdinal,
            revision: checkpoint.revision,
            stateJson: JSON.stringify(checkpoint.state),
          }
        : undefined,
      now: new Date(),
    });
    if (!persisted) {
      return fail(
        new DerivationError({
          code: "revision_conflict",
          message:
            "The derivation revision changed before this commit finished. Inspect and retry.",
          retryable: true,
          expectedRevision: args.baseRevision,
        }),
      );
    }
    await emitFormalDerivationEvent(runId, {
      type: "step_committed",
      step: committed.step,
    });
    return {
      ok: true as const,
      step: committed.step,
      result: committed.result,
      continuation: commitContinuation(committed, document.steps.length + 1),
    };
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}

export type ValidateDerivationResult =
  | ToolFailure
  | {
      ok: boolean;
      findings: ValidationFindingV1[];
      validationLevel: "formal" | "rule_checked";
      validatedRevision: number;
    };

export async function validateDerivationForRun(
  runId: string,
): Promise<ValidateDerivationResult> {
  const repository = requireFormalDerivationPersistence();
  const run = await repository.getRun(runId);
  if (!run) {
    return fail({
      ok: false,
      code: "not_found",
      message: "Derivation run was not found.",
      retryable: false,
    });
  }
  const document = parseDocument(run.documentJson);
  const checkpoints = parseCheckpoints(await repository.listCheckpoints(runId));
  const result = validateDerivationDocument(document, checkpoints);
  await repository.updateRun({
    id: runId,
    validationSummaryJson: JSON.stringify({
      ...result,
      validatedRevision: document.revision,
    }),
    now: new Date(),
  });
  await emitFormalDerivationEvent(runId, {
    type: "validation_completed",
    findings: result.findings,
  });
  return {
    ...result,
    validatedRevision: document.revision,
  };
}

/** Save an LLM control turn while retaining the existing revision/validation gate. */
export async function validateAndFinishDerivationForRun(
  runId: string,
  input: { summary: string; validatedRevision: number },
) {
  const validation = await validateDerivationForRun(runId);
  if (!validation.ok) return validation;
  // finish re-reads the durable run and checks both the requested revision and
  // the persisted validation revision, including any concurrent change.
  return finishDerivationForRun(runId, input);
}

export async function finishDerivationForRun(
  runId: string,
  input: { summary: string; validatedRevision: number },
) {
  const repository = requireFormalDerivationPersistence();
  const run = await repository.getRun(runId);
  if (!run) {
    return fail({
      ok: false,
      code: "not_found",
      message: "Derivation run was not found.",
      retryable: false,
    });
  }
  const document = parseDocument(run.documentJson);
  if (input.validatedRevision !== document.revision) {
    return fail({
      ok: false,
      code: "revision_conflict",
      message:
        "finish_derivation requires a successful validation of the current revision.",
      retryable: true,
      expectedRevision: input.validatedRevision,
      actualRevision: document.revision,
    });
  }
  if (!run.validationSummaryJson) {
    return fail({
      ok: false,
      code: "not_validated",
      message:
        "Call validate_derivation successfully before finish_derivation.",
      retryable: true,
    });
  }
  const summary = JSON.parse(run.validationSummaryJson) as {
    ok: boolean;
    findings: ValidationFindingV1[];
    validationLevel: "formal" | "rule_checked";
    validatedRevision?: number;
  };
  if (!summary.ok || summary.validatedRevision !== document.revision) {
    return fail({
      ok: false,
      code: "not_validated",
      message: "The current revision has not passed validation.",
      retryable: true,
    });
  }
  const completedAt = new Date();
  const nextDocument: DerivationDocumentV1 = {
    ...document,
    status: "complete",
    completion: {
      validatedRevision: document.revision,
      validationLevel: summary.validationLevel,
      summary: input.summary.trim(),
      completedAt: completedAt.toISOString(),
    },
  };
  const state = replayDerivation(nextDocument);
  await repository.updateRun({
    id: runId,
    status: "complete",
    documentJson: JSON.stringify(nextDocument),
    revision: nextDocument.revision,
    completedAt,
    now: completedAt,
  });
  const lastOrdinal = nextDocument.steps.at(-1)?.ordinal ?? 0;
  const existingCheckpoints = await repository.listCheckpoints(runId);
  if (!existingCheckpoints.some((item) => item.stepOrdinal === lastOrdinal)) {
    const checkpoint = createCheckpoint(state, lastOrdinal);
    await repository.saveCheckpoint({
      id: randomUUID(),
      runId,
      stepOrdinal: checkpoint.stepOrdinal,
      revision: checkpoint.revision,
      stateJson: JSON.stringify(checkpoint.state),
      now: completedAt,
    });
  }
  await emitFormalDerivationEvent(runId, {
    type: "run_completed",
    revision: nextDocument.revision,
  });
  return {
    ok: true as const,
    revision: nextDocument.revision,
    validationLevel: summary.validationLevel,
    summary: input.summary.trim(),
  };
}

type ExpansionSession = {
  runId: string;
  expansionId: string;
  replacedStepId: string;
  parentRevision: number;
  parentDocument: DerivationDocumentV1;
  buffer: DerivationDocumentV1;
  previousStatus: FormalDerivationRunStatus;
};

const expansionByRun = new Map<string, ExpansionSession>();

function prefixLength(session: ExpansionSession): number {
  return session.parentDocument.steps.findIndex(
    (step) => step.id === session.replacedStepId,
  );
}

function expansionSteps(session: ExpansionSession) {
  return session.buffer.steps.slice(prefixLength(session));
}

function persistableSteps(runId: string, document: DerivationDocumentV1) {
  return document.steps.map((step) => ({
    id: step.id,
    runId,
    ordinal: step.ordinal,
    baseRevision: step.baseRevision,
    afterRevision: step.afterRevision,
    kind: step.kind,
    actionsJson: JSON.stringify(step.actions),
    presentationJson: JSON.stringify(step.presentation),
    metadataJson: JSON.stringify(step.metadata ?? {}),
  }));
}

export function getExpansionSession(
  runId: string,
): ExpansionSession | undefined {
  return expansionByRun.get(runId);
}

export function discardExpansionSession(runId: string): void {
  expansionByRun.delete(runId);
}

export async function startExpansionSession(
  runId: string,
  stepId: string,
): Promise<
  | ToolFailure
  | {
      ok: true;
      expansionId: string;
      stepId: string;
      previousStatus: FormalDerivationRunStatus;
    }
> {
  const repository = requireFormalDerivationPersistence();
  const run = await repository.getRun(runId);
  if (!run) {
    return fail({
      ok: false,
      code: "not_found",
      message: "Derivation run was not found.",
      retryable: false,
    });
  }
  if (run.status === "running") {
    return fail({
      ok: false,
      code: "run_busy",
      message: "Wait for the current authoring or expansion run to finish.",
      retryable: true,
    });
  }
  if (expansionByRun.has(runId)) {
    return fail({
      ok: false,
      code: "run_busy",
      message: "An expansion is already in progress for this run.",
      retryable: true,
    });
  }
  const document = parseDocument(run.documentJson);
  const replaced = document.steps.find((step) => step.id === stepId);
  if (!replaced) {
    return fail({
      ok: false,
      code: "expansion_missing_step",
      message: "That step is not on the playback timeline.",
      retryable: false,
      stepId,
    });
  }
  if (!canExpandDerivationStep(replaced)) {
    return fail({
      ok: false,
      code: "expansion_not_allowed",
      message:
        "Only a teaching step can be expanded. Collapse an existing expansion first; do not expand split or join markers.",
      retryable: false,
      stepId,
    });
  }
  const index = document.steps.findIndex((step) => step.id === stepId);
  const prefix = document.steps.slice(0, index);
  const expansionId = randomUUID();
  expansionByRun.set(runId, {
    runId,
    expansionId,
    replacedStepId: stepId,
    parentRevision: run.revision,
    parentDocument: document,
    previousStatus: run.status,
    buffer: {
      ...document,
      status: "draft",
      completion: undefined,
      revision: prefix.length,
      steps: prefix,
    },
  });
  await emitFormalDerivationEvent(runId, {
    type: "expansion_started",
    expansionId,
    stepId,
  });
  return {
    ok: true,
    expansionId,
    stepId,
    previousStatus: run.status,
  };
}

export async function inspectExpansionForRun(runId: string) {
  const session = expansionByRun.get(runId);
  if (!session) {
    return fail({
      ok: false,
      code: "expansion_inactive",
      message:
        "No expansion is in progress. Inspect the parent derivation instead.",
      retryable: true,
    });
  }
  const replaced = session.parentDocument.steps.find(
    (step) => step.id === session.replacedStepId,
  );
  const prefixCount = prefixLength(session);
  const committed = expansionSteps(session).length;
  const seamDocument: DerivationDocumentV1 = {
    ...session.parentDocument,
    steps: session.parentDocument.steps.slice(0, prefixCount + 1),
    revision: prefixCount + 1,
    completion: undefined,
  };
  const inspected = compactDerivationInspect(session.buffer);
  const requiredSeam = compactDerivationInspect(seamDocument);
  return {
    ok: true as const,
    ...inspected,
    remainingSteps: Math.max(
      0,
      DERIVATION_LIMITS.maxStepsPerRun -
        session.parentDocument.steps.length +
        1 -
        committed,
    ),
    expansionId: session.expansionId,
    replacedStep: replaced
      ? {
          id: replaced.id,
          ordinal: replaced.ordinal,
          summary: replaced.metadata?.summary,
          actions: replaced.actions,
          presentation: replaced.presentation,
          branch: replaced.branch,
        }
      : null,
    requiredSeam: {
      ...requiredSeam,
      // Show commit-legal trees so the agent can copy the seam without
      // replaying legacy ungrouped apply/product shapes that commit rejects.
      formulas: requiredSeam.formulas.map((formula) => ({
        ...formula,
        tree: canonicalizeNotationTree(formula.tree),
      })),
    },
    remainingExpansionSteps: Math.max(
      0,
      DERIVATION_LIMITS.maxExpansionSteps - committed,
    ),
    remainingRunSteps: Math.max(
      0,
      DERIVATION_LIMITS.maxStepsPerRun -
        session.parentDocument.steps.length +
        1 -
        committed,
    ),
  };
}

export async function commitExpansionStepForRun(
  runId: string,
  rawArgs: unknown,
  toolCallId?: string,
) {
  const session = expansionByRun.get(runId);
  if (!session) {
    return fail({
      ok: false,
      code: "expansion_inactive",
      message: "No expansion is in progress.",
      retryable: true,
    });
  }
  let args: CommitDerivationStepArgsV1;
  try {
    args = parseCommitDerivationStepArgs(rawArgs);
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
  const committedCount = expansionSteps(session).length;
  if (committedCount >= DERIVATION_LIMITS.maxExpansionSteps) {
    return fail({
      ok: false,
      code: "expansion_step_count",
      message: `An expansion may insert at most ${DERIVATION_LIMITS.maxExpansionSteps} steps.`,
      retryable: false,
    });
  }
  const replaced = session.parentDocument.steps.find(
    (step) => step.id === session.replacedStepId,
  );
  try {
    const committed = commitDerivationStep(replayDerivation(session.buffer), {
      ...args,
      source: args.source ?? "agent",
      toolCallId: toolCallId ?? args.toolCallId,
      branch: args.branch ?? replaced?.branch,
      stepId: args.stepId ?? `${session.expansionId}-${committedCount + 1}`,
    });
    session.buffer = {
      ...session.buffer,
      steps: [...session.buffer.steps, committed.step],
      revision: committed.state.derivationRevision,
    };
    return {
      ok: true as const,
      step: committed.step,
      result: committed.result,
      continuation: {
        ...commitContinuation(committed, session.buffer.steps.length),
        remainingSteps: Math.max(
          0,
          DERIVATION_LIMITS.maxStepsPerRun -
            session.parentDocument.steps.length +
            1 -
            expansionSteps(session).length,
        ),
        remainingRunSteps: Math.max(
          0,
          DERIVATION_LIMITS.maxStepsPerRun -
            session.parentDocument.steps.length +
            1 -
            expansionSteps(session).length,
        ),
        remainingExpansionSteps: Math.max(
          0,
          DERIVATION_LIMITS.maxExpansionSteps - expansionSteps(session).length,
        ),
      },
    };
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function validateExpansionForRun(runId: string) {
  const session = expansionByRun.get(runId);
  if (!session) {
    return fail({
      ok: false,
      code: "expansion_inactive",
      message: "No expansion is in progress.",
      retryable: true,
    });
  }
  try {
    spliceExpansion(
      session.parentDocument,
      session.replacedStepId,
      expansionSteps(session),
      { expansionId: session.expansionId },
    );
    return {
      ok: true as const,
      findings: [] as ValidationFindingV1[],
      committedSteps: expansionSteps(session).length,
    };
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function finishExpansionForRun(runId: string) {
  const session = expansionByRun.get(runId);
  if (!session) {
    return fail({
      ok: false,
      code: "expansion_inactive",
      message: "No expansion is in progress.",
      retryable: true,
    });
  }
  const repository = requireFormalDerivationPersistence();
  try {
    const spliced = spliceExpansion(
      session.parentDocument,
      session.replacedStepId,
      expansionSteps(session),
      { expansionId: session.expansionId },
    );
    const validation = validateDerivationDocument(spliced.document);
    const now = new Date();
    const complete =
      session.previousStatus === "complete" && validation.ok
        ? {
            status: "complete" as const,
            completion: {
              validatedRevision: spliced.document.revision,
              validationLevel: validation.validationLevel,
              summary:
                session.parentDocument.completion?.summary ??
                "Expanded a teaching step into a finer linear sequence.",
              completedAt: now.toISOString(),
            },
          }
        : {
            status: "needs_attention" as const,
            completion: undefined,
          };
    const nextDocument: DerivationDocumentV1 = {
      ...spliced.document,
      status: complete.status === "complete" ? "complete" : "draft",
      completion: complete.completion,
    };
    const persisted = await repository.replaceSteps({
      runId,
      expectedRevision: session.parentRevision,
      documentJson: JSON.stringify(nextDocument),
      revision: nextDocument.revision,
      steps: persistableSteps(runId, nextDocument),
      now,
    });
    if (!persisted) {
      return fail(
        new DerivationError({
          code: "revision_conflict",
          message:
            "The derivation changed before this expansion finished. Inspect and retry.",
          retryable: true,
          expectedRevision: session.parentRevision,
        }),
      );
    }
    await repository.updateRun({
      id: runId,
      status: complete.status,
      documentJson: JSON.stringify(nextDocument),
      revision: nextDocument.revision,
      validationSummaryJson: JSON.stringify({
        ...validation,
        validatedRevision: nextDocument.revision,
      }),
      completedAt: complete.status === "complete" ? now : null,
      now,
    });
    const lastOrdinal = nextDocument.steps.at(-1)?.ordinal ?? 0;
    if (lastOrdinal > 0) {
      const checkpoint = createCheckpoint(
        replayDerivation(nextDocument),
        lastOrdinal,
      );
      await repository.saveCheckpoint({
        id: randomUUID(),
        runId,
        stepOrdinal: checkpoint.stepOrdinal,
        revision: checkpoint.revision,
        stateJson: JSON.stringify(checkpoint.state),
        now,
      });
    }
    expansionByRun.delete(runId);
    await emitFormalDerivationEvent(runId, {
      type: "expansion_completed",
      expansionId: session.expansionId,
      insertedCount: spliced.insertedCount,
      revision: nextDocument.revision,
    });
    return {
      ok: true as const,
      expansionId: session.expansionId,
      insertedCount: spliced.insertedCount,
      revision: nextDocument.revision,
      status: complete.status,
    };
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function collapseExpansionForRun(
  runId: string,
  expansionId: string,
) {
  const repository = requireFormalDerivationPersistence();
  const run = await repository.getRun(runId);
  if (!run) {
    return fail({
      ok: false,
      code: "not_found",
      message: "Derivation run was not found.",
      retryable: false,
    });
  }
  if (run.status === "running" || expansionByRun.has(runId)) {
    return fail({
      ok: false,
      code: "run_busy",
      message:
        "Wait for the current run to finish before collapsing an expansion.",
      retryable: true,
    });
  }
  const document = parseDocument(run.documentJson);
  try {
    const nextDocument = collapseExpansion(document, expansionId);
    const now = new Date();
    const persisted = await repository.replaceSteps({
      runId,
      expectedRevision: run.revision,
      documentJson: JSON.stringify(nextDocument),
      revision: nextDocument.revision,
      steps: persistableSteps(runId, nextDocument),
      now,
    });
    if (!persisted) {
      return fail(
        new DerivationError({
          code: "revision_conflict",
          message: "The derivation changed before collapse finished.",
          retryable: true,
          expectedRevision: run.revision,
        }),
      );
    }
    const validation = validateDerivationDocument(nextDocument);
    await repository.updateRun({
      id: runId,
      status:
        run.status === "complete" && validation.ok
          ? "complete"
          : "needs_attention",
      documentJson: JSON.stringify(nextDocument),
      revision: nextDocument.revision,
      completedAt: run.status === "complete" && validation.ok ? now : null,
      now,
    });
    await emitFormalDerivationEvent(runId, {
      type: "expansion_collapsed",
      expansionId,
      revision: nextDocument.revision,
    });
    return {
      ok: true as const,
      expansionId,
      revision: nextDocument.revision,
    };
  } catch (error) {
    return fail(error instanceof Error ? error : new Error(String(error)));
  }
}
