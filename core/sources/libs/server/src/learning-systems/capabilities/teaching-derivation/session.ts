import { randomUUID } from "node:crypto";
import { learnerFacingContentIssues } from "../../../../../domain/src/learner-facing-content.js";
import type { TeachingDerivationRepository } from "../../../../../domain/src/index.js";
import {
  ANALYZER_VERSION,
  MATCHER_VERSION,
  PARSER_VERSION,
  TRANSITION_COMPILER_VERSION,
} from "../../../../../formula-analysis/src/index.js";
import {
  TEACHING_DERIVATION_STEP_REPAIR_LIMIT,
  compileTeachingDerivation,
  assessTeachingPresentation,
  normalizeCommitStepArgs,
  parseTeachingDerivationDocument,
  validateCommittedStep,
  validateFinishedDocument,
  type TeachingDerivationDocumentV1,
} from "../../../../../teaching-derivation/src/index.js";
import { requireTeachingDerivationPersistence } from "./persistence.js";
import {TEACHING_DERIVATION_PROMPT_VERSION} from "./keys.js";

export type TeachingDerivationRunEventV1 =
  | { type: "agent_message"; message: string }
  | { type: "run_started"; runId: string }
  | {
      type: "run_failed";
      error: { code: string; message: string; retryable?: boolean };
    }
  | { type: "run_cancelled" }
  | {
      type: "tool_started";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: "tool_finished"; toolCallId: string; ok: boolean; result: unknown }
  | { type: "step_committed"; ordinal: number };

function persistence(): TeachingDerivationRepository {
  return requireTeachingDerivationPersistence();
}

async function loadDocument(
  runId: string,
): Promise<TeachingDerivationDocumentV1> {
  const run = await persistence().getRun(runId);
  if (!run) throw new Error(`Teaching derivation run ${runId} is missing`);
  return requireValidDocument(JSON.parse(run.documentJson), runId);
}

function requireValidDocument(value: unknown, runId: string): TeachingDerivationDocumentV1 {
  const parsed = parseTeachingDerivationDocument(value);
  if (!parsed) {
    throw new Error(`Cannot read saved teaching derivation ${runId}; committed steps were preserved.`);
  }
  return parsed;
}

/** A local formula-animation fallback must retain the independent narration
 * and companion contract. Only unsupported formula targets/intents simplify. */
function conservativeStepArgs(input: Record<string, unknown>) {
  const {targets: _targets, intents: _intents, ...plain} = input;
  return { ...plain,
    ...(Array.isArray(input.cues) ? {cues: input.cues.map(cue =>
      cue && typeof cue === "object" && !Array.isArray(cue) ? {...cue, targetIds: []} : cue)} : {}),
  };
}

export async function emitTeachingDerivationEvent(
  runId: string,
  event: TeachingDerivationRunEventV1,
): Promise<void> {
  await persistence().appendEvent({
    runId,
    eventJson: JSON.stringify(event),
    now: new Date(),
  });
}

export async function inspectTeachingDerivationForRun(runId: string) {
  const run = await persistence().getRun(runId);
  if (!run) {
    return {
      ok: false,
      code: "missing_run",
      message: "This teaching derivation run is missing.",
      retryable: false,
    };
  }
  const document = await loadDocument(runId);
  return {
    ok: true,
    revision: run.revision,
    repairAttempts: run.repairAttempts,
    nextStepIndex: document.steps.length + 1,
    document: {
      title: document.title,
      teachingGoal: document.teachingGoal,
      givens: document.givens,
      symbols: document.symbols ?? [],
      visualAssets: document.visualAssets?.map(asset => ({ id: asset.id, title: asset.title,
        targets: asset.segmentation.regions.map(region => ({ id: region.id, label: region.label })) })) ?? [],
      visualDisplays: document.visualDisplays?.map(display => ({ id: display.id, title: display.title, targetIds: display.targetIds })) ?? [],
      stepCount: document.steps.length,
      steps: document.steps.map((step) => ({
        index: step.index,
        relation: step.relation,
        board: step.board,
        focusFormulaKey: step.focusFormulaKey,
        visual: step.visual,
        givenIndexes: step.givenIndexes,
      })),
    },
  };
}

export async function commitTeachingStepForRun(
  runId: string,
  rawArgs: unknown,
  acceptedFallbackReason?: string,
  expectedRevision?: number,
) {
  const run = await persistence().getRun(runId);
  if (!run) {
    return {
      ok: false,
      code: "missing_run",
      message: "This teaching derivation run is missing.",
      retryable: false,
    };
  }
  if (expectedRevision != null && run.revision !== expectedRevision) return { ok: false, code: "revision_conflict", retryable: false };
  const document = await loadDocument(runId);
  const normalized = normalizeCommitStepArgs(rawArgs);
  const requestedIndex =
    typeof normalized.index === "number"
      ? normalized.index
      : document.steps.length + 1;
  if (requestedIndex <= document.steps.length) {
    const existing = await persistence().getStepByOrdinal(
      runId,
      requestedIndex,
    );
    if (existing) {
      return {
        ok: true,
        idempotent: true,
        continuation: {
          committedIndex: requestedIndex,
          nextStepIndex: document.steps.length + 1,
          revision: run.revision,
        },
      };
    }
  }
  let validated = validateCommittedStep(document, normalized);
  for (const issue of learnerFacingContentIssues(normalized)) {
    validated.ok = false;
    validated.issues.push({ code: "learner_content_invalid", message: issue.message, path: issue.path.join(".") });
  }
  if (run.promptVersion === "teaching-derivation-authoring.v3") {
    const cues = Array.isArray(normalized.cues) ? normalized.cues : undefined;
    if (!cues?.length) {
      validated.ok = false;
      validated.issues.push({code: "explanation_cues_missing", message: "New teaching content requires ordered spoken cues. Keep all reasoning across complete steps instead of putting the whole explanation on one screen.", path: "cues"});
    } else if (cues.some(cue => !cue || typeof cue !== "object" || typeof cue.onScreenText !== "string" || !cue.onScreenText.trim())) {
      validated.ok = false;
      validated.issues.push({code: "screen_explanation_missing", message: "Every new cue requires a brief onScreenText (up to 160 characters), independently of its complete spoken text.", path: "cues.onScreenText"});
    }
  }
  const quality = validated.step && !acceptedFallbackReason && ["teaching-derivation-authoring.v2", TEACHING_DERIVATION_PROMPT_VERSION].includes(run.promptVersion)
    ? assessTeachingPresentation(document, validated.step) : undefined;
  if (quality?.issues.length) {
    validated.ok = false;
    validated.issues.push(...quality.issues);
  }
  // Presentation metadata is optional. Revalidate the unchanged content without
  // it before accepting a conservative transition; never bypass core checks.
  if (!validated.ok && !acceptedFallbackReason
    && !validated.issues.some(issue => issue.code.startsWith("visual_") || issue.code === "given_index_invalid"
      || issue.code === "explanation_cues_missing" || issue.code === "screen_explanation_missing" || issue.code === "learner_content_invalid")) {
    const conservative = validateCommittedStep(document, conservativeStepArgs(normalized));
    if (conservative.ok && conservative.step) {
      acceptedFallbackReason = `Automatically simplified presentation: ${JSON.stringify(validated.issues)}`.slice(0, 2000);
      validated = conservative;
    }
  }
  if (!validated.ok || !validated.step) {
    const repairAttempts = run.repairAttempts + 1;
    const pending = validated.step ?? validateCommittedStep(document, conservativeStepArgs(normalized)).step;
    await persistence().updateRun({
      id: runId,
      repairAttempts,
      ...(repairAttempts >= TEACHING_DERIVATION_STEP_REPAIR_LIMIT ? { status: "needs_attention" as const } : {}),
      validationSummaryJson: JSON.stringify({ issues: validated.issues, pendingStep: pending ?? null, revision: run.revision, metrics: quality?.metrics }),
      now: new Date(),
    });
    return {
      ok: false,
      code: "step_invalid",
      message:
        repairAttempts >= TEACHING_DERIVATION_STEP_REPAIR_LIMIT
          ? "This step still fails content validation after two repairs. Keep the draft and stop; retry to repair the formula or step references."
          : "Fix the current teaching step. Do not rewrite already committed steps.",
      retryable: repairAttempts < TEACHING_DERIVATION_STEP_REPAIR_LIMIT,
      issues: validated.issues,
      repairAttempts,
    };
  }
  if (acceptedFallbackReason) validated.step = { ...validated.step, presentationFallback: acceptedFallbackReason };
  const nextDocument: TeachingDerivationDocumentV1 = {
    ...document,
    teachingGoal: validated.setup?.teachingGoal ?? document.teachingGoal,
    givens: validated.setup?.givens ?? document.givens,
    symbols: validated.setup?.symbols ?? document.symbols,
    steps: [...document.steps, validated.step],
    revision: run.revision + 1,
    status: "draft",
  };
  // Never acknowledge a commit that the next inspect/finish cannot read.
  requireValidDocument(nextDocument, runId);
  const derived = compileTeachingDerivation(nextDocument);
  const appended = await persistence().appendStep({
    runId,
    expectedRevision: run.revision,
    documentJson: JSON.stringify(nextDocument),
    derivedJson: JSON.stringify(derived),
    revision: nextDocument.revision,
    repairAttempts: 0,
    step: {
      id: randomUUID(),
      runId,
      ordinal: validated.step.index,
      stepJson: JSON.stringify(validated.step),
      derivedJson: JSON.stringify(
        derived.steps[derived.steps.length - 1] ?? {},
      ),
    },
    now: new Date(),
  });
  if (!appended) {
    const latest = await persistence().getStepByOrdinal(
      runId,
      validated.step.index,
    );
    if (latest) {
      return {
        ok: true,
        idempotent: true,
        continuation: {
          committedIndex: validated.step.index,
          nextStepIndex: validated.step.index + 1,
          revision: run.revision,
        },
      };
    }
    return {
      ok: false,
      code: "revision_conflict",
      message:
        "The run revision changed. Inspect and continue from the live document.",
      retryable: true,
    };
  }
  return {
    ok: true,
    continuation: {
      committedIndex: validated.step.index,
      nextStepIndex: validated.step.index + 1,
      revision: nextDocument.revision,
      premiseBoard: validated.step.board.filter(
        (formula) => formula.role === "reference",
      ),
      workingBoard: validated.step.board.filter(
        (formula) => formula.role === "primary",
      ),
      presentationQuality: quality ?? null,
      analysisStatus:
        derived.steps[derived.steps.length - 1]?.formulas.map((formula) => ({
          key: formula.key,
          syntaxStatus: formula.statuses.syntaxStatus,
          analysisStatus: formula.statuses.analysisStatus,
          animationStatus: formula.statuses.animationStatus,
        })) ?? [],
    },
  };
}

export async function finishTeachingDerivationForRun(
  runId: string,
  args: { summary?: string },
) {
  const run = await persistence().getRun(runId);
  if (!run) {
    return {
      ok: false,
      code: "missing_run",
      message: "This teaching derivation run is missing.",
      retryable: false,
    };
  }
  const document = await loadDocument(runId);
  const issues = validateFinishedDocument(document);
  for (const issue of learnerFacingContentIssues(args))
    issues.push({ code: "learner_content_invalid", message: issue.message, path: issue.path.join(".") });
  if (issues.length) {
    return {
      ok: false,
      code: "finish_invalid",
      message: issues[0]?.message ?? "The teaching derivation is not complete.",
      retryable: true,
      issues,
    };
  }
  const finished: TeachingDerivationDocumentV1 = {
    ...document,
    summary: args.summary?.trim() || document.summary,
    status: "complete",
    revision: run.revision + 1,
  };
  requireValidDocument(finished, runId);
  const derived = compileTeachingDerivation(finished);
  await persistence().updateRun({
    id: runId,
    status: "complete",
    revision: finished.revision,
    documentJson: JSON.stringify(finished),
    derivedJson: JSON.stringify(derived),
    completedAt: new Date(),
    now: new Date(),
  });
  return {
    ok: true,
    continuation: {
      stepCount: finished.steps.length,
      revision: finished.revision,
    },
  };
}

export function shouldForwardLiveTeachingDocument(
  event: TeachingDerivationRunEventV1,
): boolean {
  if (event.type === "step_committed") return true;
  if (event.type !== "tool_finished" || !event.ok) return false;
  const result = event.result;
  return Boolean(
    result &&
    typeof result === "object" &&
    "ok" in result &&
    (result as { ok?: unknown }).ok === true &&
    "continuation" in result,
  );
}
