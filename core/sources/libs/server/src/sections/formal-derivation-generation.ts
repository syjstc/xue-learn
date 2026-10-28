import { randomUUID } from "node:crypto";
import {
  DERIVATION_SCHEMA_VERSION,
  emptyDerivationDocument,
  parseDerivationDocument,
  type DerivationDocumentV1,
} from "../../../formal-derivation/src/index.js";
import { runFormalDerivationAgent } from "../formal-derivation/agent-runner.js";
import {
  UNIT_FORMAL_DERIVATION_OPERATION,
  FORMAL_DERIVATION_PROMPT_VERSION,
} from "../learning-systems/capabilities/formal-derivation/keys.js";
import { buildFormalDerivationInvocationPrompt } from "../learning-systems/capabilities/formal-derivation/prompt.js";
import { emitFormalDerivationEvent } from "../learning-systems/capabilities/formal-derivation/session.js";
import { requireFormalDerivationPersistence } from "../learning-systems/capabilities/formal-derivation/persistence.js";
import type { UnitSectionPlanRepository } from "../../../domain/src/index.js";
import {
  selectResumableFormalDerivationRun,
  shouldForwardLiveDerivationDocument,
  tryParseLiveDerivationDocument,
} from "./formal-derivation-live.js";

export {
  selectResumableFormalDerivationRun,
  shouldForwardLiveDerivationDocument,
  tryParseLiveDerivationDocument,
} from "./formal-derivation-live.js";

export function buildUnitFormalDerivationRequirement(input: {
  unitTitle: string;
  sectionTitle: string;
  contentSummary: string;
  previousSectionContext?: string;
}): {
  text: string;
  target: string;
} {
  const lines = [
    `Author a complete teaching derivation for this lesson section.`,
    `Unit: ${input.unitTitle.trim()}`,
    `Section: ${input.sectionTitle.trim()}`,
    input.contentSummary.trim()
      ? `Section focus:\n${input.contentSummary.trim()}`
      : "",
    input.previousSectionContext?.trim()
      ? `Previous section (context only; do not re-teach it):\n${input.previousSectionContext.trim()}`
      : "",
  ].filter(Boolean);
  return {
    text: lines.join("\n\n"),
    target: input.sectionTitle.trim(),
  };
}

export async function generateUnitFormalDerivationSection(params: {
  userId: string;
  goalId: string;
  unitId: string;
  sectionId: string;
  token: string;
  force: boolean;
  locale: string;
  unitTitle: string;
  sectionTitle: string;
  contentSummary: string;
  previousSectionContext?: string;
  generationRunId?: string;
  signal?: AbortSignal;
  repository: UnitSectionPlanRepository;
  onPartialDerivation?: (
    document: DerivationDocumentV1,
  ) => void | Promise<void>;
  onBeforePublish?: () => void | Promise<void>;
}): Promise<{ contentRevision: number }> {
  const requirement = buildUnitFormalDerivationRequirement({
    unitTitle: params.unitTitle,
    sectionTitle: params.sectionTitle,
    contentSummary: params.contentSummary,
    previousSectionContext: params.previousSectionContext,
  });
  const persistence = requireFormalDerivationPersistence();
  const resumable = params.force
    ? null
    : selectResumableFormalDerivationRun(
        await persistence.listRunsBySection(params.sectionId),
        params.sectionId,
      );
  const now = new Date();
  let runId: string;
  let resume:
    | { committedSteps: number; revision: number }
    | undefined;
  if (resumable) {
    runId = resumable.id;
    const live = tryParseLiveDerivationDocument(resumable.documentJson);
    resume = live
      ? { committedSteps: live.steps.length, revision: live.revision }
      : undefined;
    await persistence.updateRun({
      id: runId,
      status: "running",
      now,
    });
  } else {
    runId = randomUUID();
    const document = emptyDerivationDocument({
      id: runId,
      title: params.sectionTitle,
      locale: params.locale,
      requirement: {
        text: requirement.text,
        target: requirement.target,
      },
    });
    await persistence.createRun({
      id: runId,
      title: params.sectionTitle,
      locale: params.locale,
      schemaVersion: DERIVATION_SCHEMA_VERSION,
      promptVersion: FORMAL_DERIVATION_PROMPT_VERSION,
      requirementJson: JSON.stringify(document.requirement),
      documentJson: JSON.stringify(document),
      status: "running",
      operation: UNIT_FORMAL_DERIVATION_OPERATION,
      ownerUserId: params.userId,
      unitId: params.unitId,
      sectionId: params.sectionId,
      now,
    });
  }
  await emitFormalDerivationEvent(runId, { type: "run_started", runId });
  const forwardLiveDocument = async () => {
    if (!params.onPartialDerivation) return;
    const current = await persistence.getRun(runId);
    if (!current) return;
    const live = tryParseLiveDerivationDocument(current.documentJson);
    if (live) await params.onPartialDerivation(live);
  };
  await forwardLiveDocument();
  let failureMessage =
    "Formal derivation generation did not finish a valid teaching script.";
  try {
    await runFormalDerivationAgent({
      runId,
      userId: params.userId,
      title: params.sectionTitle,
      locale: params.locale,
      requirementText: requirement.text,
      target: requirement.target,
      invocationPrompt: buildFormalDerivationInvocationPrompt({
        title: params.sectionTitle,
        locale: params.locale,
        requirementText: requirement.text,
        target: requirement.target,
        resume,
      }),
      traceId: params.generationRunId ?? runId,
      signal: params.signal,
      send: async (event) => {
        if (event.type === "run_failed") {
          failureMessage = event.error.message;
          await emitFormalDerivationEvent(runId, event);
        } else if (event.type === "run_cancelled") {
          await emitFormalDerivationEvent(runId, event);
          await persistence.updateRun({
            id: runId,
            status: "cancelled",
            now: new Date(),
          });
        }
        if (shouldForwardLiveDerivationDocument(event)) {
          await forwardLiveDocument();
        }
      },
      operation: UNIT_FORMAL_DERIVATION_OPERATION,
      platformFunded: false,
    });
  } catch (cause) {
    failureMessage =
      cause instanceof Error ? cause.message : failureMessage;
    throw cause instanceof Error ? cause : new Error(failureMessage);
  } finally {
    const current = await persistence.getRun(runId);
    if (
      current &&
      current.status !== "complete" &&
      current.status !== "cancelled" &&
      current.status !== "failed"
    ) {
      await persistence.updateRun({
        id: runId,
        status: "failed",
        now: new Date(),
      });
    }
  }
  const run = await persistence.getRun(runId);
  if (!run || run.status !== "complete") {
    throw new Error(
      run?.status === "cancelled"
        ? "Formal derivation generation was cancelled."
        : failureMessage,
    );
  }
  parseDerivationDocument(JSON.parse(run.documentJson) as unknown);
  await params.onBeforePublish?.();
  return params.repository.publishGeneratedDerivation({
    userId: params.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    sectionId: params.sectionId,
    token: params.token,
    force: params.force,
    runId,
    documentJson: run.documentJson,
  });
}
