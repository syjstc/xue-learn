import { randomUUID } from "node:crypto";
import {
  ANALYZER_VERSION,
  MATCHER_VERSION,
  PARSER_VERSION,
  TRANSITION_COMPILER_VERSION,
} from "../../../formula-analysis/src/index.js";
import {
  TEACHING_DERIVATION_SCHEMA_VERSION,
  compileTeachingDerivation,
  emptyTeachingDerivationDocument,
  parseTeachingDerivationDocument,
  type TeachingDerivationDerivedV1,
  type TeachingDerivationDocumentV1,
  type TeachingVisualAssetV1, type TeachingVisualDisplayV1,
  teachingVisualAssetSchema, teachingVisualDisplaySchema,
} from "../../../teaching-derivation/src/index.js";
import { runTeachingDerivationAgent } from "../teaching-derivation/agent-runner.js";
import {
  UNIT_TEACHING_DERIVATION_OPERATION,
  TEACHING_DERIVATION_PROMPT_VERSION,
} from "../learning-systems/capabilities/teaching-derivation/keys.js";
import { buildTeachingDerivationInvocationPrompt } from "../learning-systems/capabilities/teaching-derivation/prompt.js";
import { emitTeachingDerivationEvent } from "../learning-systems/capabilities/teaching-derivation/session.js";
import { requireTeachingDerivationPersistence } from "../learning-systems/capabilities/teaching-derivation/persistence.js";
import type { UnitSectionPlanRepository, TeachingDerivationRunRecord } from "../../../domain/src/index.js";
import {
  selectResumableTeachingDerivationRun,
  shouldForwardLiveTeachingDocument,
  tryParseLiveTeachingDocument,
} from "./teaching-derivation-live.js";
import { teachingVisualCatalogPrompt } from "./teaching-derivation-visuals.js";

export function buildUnitTeachingDerivationRequirement(input: {
  unitTitle: string;
  sectionTitle: string;
  contentSummary: string;
  previousSectionContext?: string;
  visualAssets?: readonly TeachingVisualAssetV1[];
  visualDisplays?: readonly TeachingVisualDisplayV1[];
}): { text: string; target: string } {
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
    "Write complete LaTeX formulas, justification, and classroom narration. The server builds the formula tree and animation.",
    input.visualAssets?.length || input.visualDisplays?.length
      ? `Accepted visual catalog (reuse exact IDs and evidence):\n${teachingVisualCatalogPrompt(input)}` : "",
  ].filter(Boolean);
  return {
    text: lines.join("\n\n"),
    target: input.sectionTitle.trim(),
  };
}

export type TeachingDerivationGenerationParams = {
  userId: string;
  unitId: string;
  sectionId?: string;
  token: string;
  force?: boolean;
  locale: string;
  unitTitle: string;
  sectionTitle: string;
  contentSummary: string;
  previousSectionContext?: string;
  visualAssets?: readonly TeachingVisualAssetV1[];
  visualDisplays?: readonly TeachingVisualDisplayV1[];
  generationRunId?: string;
  signal?: AbortSignal;
  /** Explicit owned runs never fall back to another section run. */
  runId?: string;
  runScope?: Readonly<Record<string, string | number>>;
  onRunPrepared?: (runId: string) => void | Promise<void>;
  onPartialTeachingDerivation?: (
    document: TeachingDerivationDocumentV1,
    derived: TeachingDerivationDerivedV1 | null,
  ) => void | Promise<void>;
};

/** Shared ordinary generation lifecycle. Consumers decide where to publish the
 * unchanged completed document; tools, step persistence and resume stay shared. */
export async function generateTeachingDerivationDocument(params: TeachingDerivationGenerationParams): Promise<{
  run: TeachingDerivationRunRecord; document: TeachingDerivationDocumentV1;
}> {
  let requirement = buildUnitTeachingDerivationRequirement({
    unitTitle: params.unitTitle,
    sectionTitle: params.sectionTitle,
    contentSummary: params.contentSummary,
    previousSectionContext: params.previousSectionContext,
    visualAssets: params.visualAssets,
    visualDisplays: params.visualDisplays,
  });
  const persistence = requireTeachingDerivationPersistence();
  params.signal?.throwIfAborted();
  if (params.runId && params.force) throw Error("Cannot replace an explicitly owned teaching-derivation run");
  const resumable = params.runId ? await persistence.getRun(params.runId)
    : !params.force && !params.runScope && params.sectionId ? selectResumableTeachingDerivationRun(
        await persistence.listRunsBySection(params.sectionId), params.sectionId,
      ) : null;
  if (params.runId) {
    if (!resumable || resumable.ownerUserId !== params.userId || resumable.unitId !== params.unitId
      || (resumable.sectionId ?? undefined) !== params.sectionId || resumable.operation !== UNIT_TEACHING_DERIVATION_OPERATION)
      throw Error("Teaching-derivation run does not belong to this source");
    const scope = JSON.parse(resumable.requirementJson).sourceScope;
    const expected = params.runScope;
    if (JSON.stringify(Object.entries(scope ?? {}).sort()) !== JSON.stringify(Object.entries(expected ?? {}).sort()))
      throw Error("Teaching-derivation run must retain its exact source scope");
    const savedDocument = parseTeachingDerivationDocument(JSON.parse(resumable.documentJson));
    if (!savedDocument || savedDocument.revision !== resumable.revision
      || savedDocument.steps.some((step, index) => step.index !== index + 1))
      throw Error("Teaching-derivation run must retain its exact saved document and ordered step prefix");
    if (resumable.status === "complete") {
      const document = savedDocument;
      if (document.status !== "complete") throw Error("Completed teaching-derivation run has no complete document");
      await params.onRunPrepared?.(resumable.id);
      await params.onPartialTeachingDerivation?.(document, compileTeachingDerivation(document));
      return {run: resumable, document};
    }
  }
  const now = new Date();
  let runId: string;
  let resume: { committedSteps: number; revision: number } | undefined;
  if (resumable) {
    runId = resumable.id;
    const live = tryParseLiveTeachingDocument(resumable.documentJson);
    if (live) requirement = buildUnitTeachingDerivationRequirement({ ...params,
      visualAssets: live.visualAssets, visualDisplays: live.visualDisplays });
    resume = live
      ? { committedSteps: live.steps.length, revision: live.revision }
      : undefined;
    await persistence.updateRun({
      id: runId,
      status: "running",
      generationToken: params.token,
      now,
    });
  } else {
    runId = randomUUID();
    const document = { ...emptyTeachingDerivationDocument({
      id: runId,
      title: params.sectionTitle,
      locale: params.locale,
    }),
      ...(params.visualAssets?.length ? { visualAssets: params.visualAssets.map(asset => teachingVisualAssetSchema.parse(asset)) } : {}),
      ...(params.visualDisplays?.length ? { visualDisplays: params.visualDisplays.map(display => teachingVisualDisplaySchema.parse(display)) } : {}),
    };
    await persistence.createRun({
      id: runId,
      title: params.sectionTitle,
      locale: params.locale,
      schemaVersion: TEACHING_DERIVATION_SCHEMA_VERSION,
      promptVersion: TEACHING_DERIVATION_PROMPT_VERSION,
      requirementJson: JSON.stringify({...requirement, ...(params.runScope ? {sourceScope: params.runScope} : {})}),
      documentJson: JSON.stringify(document),
      derivedJson: JSON.stringify(compileTeachingDerivation(document)),
      parserVersion: PARSER_VERSION,
      analyzerVersion: ANALYZER_VERSION,
      matcherVersion: MATCHER_VERSION,
      compilerVersion: TRANSITION_COMPILER_VERSION,
      status: "running",
      generationToken: params.token,
      operation: UNIT_TEACHING_DERIVATION_OPERATION,
      ownerUserId: params.userId,
      unitId: params.unitId,
      sectionId: params.sectionId,
      now,
    });
  }
  // Persist the consumer reference before any provider work can commit a step.
  await params.onRunPrepared?.(runId);
  params.signal?.throwIfAborted();
  await emitTeachingDerivationEvent(runId, { type: "run_started", runId });
  const forwardLiveDocument = async () => {
    if (!params.onPartialTeachingDerivation) return;
    const current = await persistence.getRun(runId);
    if (!current) return;
    const live = tryParseLiveTeachingDocument(current.documentJson);
    if (!live) return;
    let derived: TeachingDerivationDerivedV1 | null = null;
    try {
      derived = JSON.parse(current.derivedJson) as TeachingDerivationDerivedV1;
    } catch {
      derived = compileTeachingDerivation(live);
    }
    await params.onPartialTeachingDerivation(live, derived);
  };
  await forwardLiveDocument();
  let failureMessage =
    "Teaching derivation generation did not finish a valid teaching script.";
  try {
    await runTeachingDerivationAgent({
      runId,
      userId: params.userId,
      title: params.sectionTitle,
      locale: params.locale,
      requirementText: requirement.text,
      target: requirement.target,
      invocationPrompt: buildTeachingDerivationInvocationPrompt({
        title: params.sectionTitle,
        locale: params.locale,
        requirementText: requirement.text,
        resume,
      }),
      traceId: params.generationRunId ?? runId,
      signal: params.signal,
      send: async (event) => {
        if (event.type === "run_failed") {
          failureMessage = event.error.message;
          await emitTeachingDerivationEvent(runId, event);
        } else if (event.type === "run_cancelled") {
          await emitTeachingDerivationEvent(runId, event);
          await persistence.updateRun({
            id: runId,
            status: "cancelled",
            now: new Date(),
          });
        }
        if (shouldForwardLiveTeachingDocument(event)) {
          await forwardLiveDocument();
        }
      },
      operation: UNIT_TEACHING_DERIVATION_OPERATION,
      platformFunded: false,
    });
  } catch (cause) {
    failureMessage = cause instanceof Error ? cause.message : failureMessage;
    throw cause instanceof Error ? cause : new Error(failureMessage);
  } finally {
    const current = await persistence.getRun(runId);
    if (
      current &&
      current.status !== "complete" &&
      current.status !== "cancelled" &&
      current.status !== "failed" &&
      current.status !== "needs_attention"
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
        ? "Teaching derivation generation was cancelled."
        : failureMessage,
    );
  }
  const published = parseTeachingDerivationDocument(
    JSON.parse(run.documentJson) as unknown,
  );
  if (!published || published.status !== "complete") {
    throw new Error(failureMessage);
  }
  return {run, document: published};
}

export async function generateUnitTeachingDerivationSection(params: TeachingDerivationGenerationParams & {
  goalId: string; sectionId: string; force: boolean; repository: UnitSectionPlanRepository;
  onBeforePublish?: () => void | Promise<void>;
}): Promise<{contentRevision: number}> {
  const {run} = await generateTeachingDerivationDocument(params);
  await params.onBeforePublish?.();
  return params.repository.publishGeneratedTeachingDerivation({
    userId: params.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    sectionId: params.sectionId,
    token: params.token,
    force: params.force,
    runId: run.id,
    documentJson: run.documentJson,
    derivedJson: run.derivedJson,
    parserVersion: run.parserVersion,
    analyzerVersion: run.analyzerVersion,
    matcherVersion: run.matcherVersion,
    compilerVersion: run.compilerVersion,
  });
}
