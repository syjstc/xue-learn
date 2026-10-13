import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  verifyAndRepairLearningMaterial,
  verifyAndRepairSurvey,
  type ContentVerificationResult,
} from "../../content-verification/index.js";
import { stripIllustrationBlocksIfDisabled } from "../../images/enrich-material.js";
import { stripLearningMaterialCitationMarkers } from "../../citations/inline-citations.js";
import { streamCourseMaterialItems } from "../../llm/course-material-tool-stream.js";
import type { MaterialGenerationPolicy } from "../../llm/component-dsl-registry.js";
import { prepareSectionMaterialAuthoring } from "../../material/authoring.js";
import {
  normalizeSurveyPreviewEnvelopeCandidate,
  prepareSurveyAuthoring,
  type PrepareSurveyAuthoringInput,
  type SurveyPreview,
  type SurveyPreviewItem,
} from "../../survey/authoring.js";
import {
  runSectionPlanAuthoringAgent,
  runSectionMaterialAuthoringAgent,
  runSurveyAuthoringAgent,
} from "../../unit-authoring/runner.js";
import {
  compactSurveySectionPlanBindingSchema,
  prepareSectionPlanAuthoring,
  type PrepareSectionPlanAuthoringInput,
  type SurveySectionPlanObject,
} from "../../survey/section-plan.js";
import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { normalizeGeneratedJsonValue } from "../../llm/structured-recovery.js";
import { missingSqJitItemRepairs } from "../../llm/jit-structured-items.js";
import type { LearningSystemSubject } from "../../learning-systems/types.js";
import type {
  LearningMaterialContent,
  SqPreview,
} from "../../llm/schemas.js";
import { withSqComponentSelection } from "../../llm/sq-preview-dsl.js";
import type { EvaluableOperation, OperationExecutionContext } from "./types.js";
import { registerOperationAdapter } from "./registry.js";
import {
  artifactContextSeedSchema,
  hashArtifactContext,
  runArtifactGenerationWorkflow,
  type ArtifactContextSeed,
} from "./artifact-workflow.js";

export type StructuredVerificationInput = {
  unitTitle: string;
  objective: string;
  learningTargets: string;
  evidenceContext: string;
  modeOverride?: "off" | "shadow" | "enforce";
  generationRunId?: string;
};

export type LearningMaterialOperationInput = {
  prompt: string;
  generationPolicy: MaterialGenerationPolicy;
  componentContext: {
    unitTitle: string;
    language: string;
    context: string;
    /** Compact nested SVG/component prompts against the durable authoring transcript. */
    authoringScope?: {
      userId: string;
      goalId: string;
      unitId: string;
    };
  };
  contextSubject?: LearningSystemSubject;
  contextQuery?: string;
  contextInvocation?: unknown;
  meta?: Record<string, unknown>;
  verification?: StructuredVerificationInput;
  artifactContext?: ArtifactContextSeed;
  authoringAgent?: {
    userId: string;
    goalId: string;
    unitId: string;
    sectionId: string;
    skipSurvey?: boolean;
    force?: boolean;
    rewriteTopicId?: string;
    rewriteTopicIndex?: number;
    publishedMaterial?: LearningMaterialContent;
    languageBlock?: string;
    guidedImagePersonaRef?: string;
  };
};

export const learningMaterialOperationInputSchema = z.object({
  prompt: z.string().min(1),
  generationPolicy: z.custom<MaterialGenerationPolicy>(),
  componentContext: z.object({
    unitTitle: z.string().min(1),
    language: z.string().min(1),
    context: z.string(),
    authoringScope: z
      .object({
        userId: z.string().min(1),
        goalId: z.string().min(1),
        unitId: z.string().min(1),
      })
      .optional(),
  }),
  contextSubject: z
    .object({
      userId: z.string().optional(),
      goalId: z.string().optional(),
      unitId: z.string().optional(),
      threadId: z.string().optional(),
    })
    .optional(),
  contextQuery: z.string().optional(),
  contextInvocation: z.unknown().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  verification: z
    .object({
      unitTitle: z.string().min(1),
      objective: z.string(),
      learningTargets: z.string(),
      evidenceContext: z.string(),
      modeOverride: z.enum(["off", "shadow", "enforce"]).optional(),
      generationRunId: z.string().optional(),
    })
    .optional(),
  artifactContext: artifactContextSeedSchema.optional(),
  authoringAgent: z
    .object({
      userId: z.string().min(1),
      goalId: z.string().min(1),
      unitId: z.string().min(1),
      sectionId: z.string().min(1),
      skipSurvey: z.boolean().optional(),
      force: z.boolean().optional(),
      rewriteTopicId: z.string().min(1).optional(),
      rewriteTopicIndex: z.number().int().min(0).max(7).optional(),
      publishedMaterial: z.custom<LearningMaterialContent>().optional(),
      languageBlock: z.string().optional(),
      guidedImagePersonaRef: z.literal("builtin:ruiyan_shadow_female").optional(),
    })
    .optional(),
}) satisfies z.ZodType<LearningMaterialOperationInput>;

function defaultArtifactContext(
  operation: string,
  context: OperationExecutionContext,
): ArtifactContextSeed {
  const identity = JSON.stringify({ operation, subject: context.subject });
  return {
    sequenceId: `artifact:${hashArtifactContext(identity).slice(0, 24)}`,
    entries: [],
  };
}

function materialVerificationEvents(context: OperationExecutionContext) {
  return {
    onVerificationStart: async () => {
      await context.events.emit({
        type: "verification",
        operation: "unit.learning_material",
        status: "started",
      });
    },
    onVerificationComplete: async (status: ContentVerificationResult) => {
      context.trace.record({
        type: "verification",
        status,
      });
      await context.events.emit({
        type: "verification",
        operation: "unit.learning_material",
        status,
      });
    },
    onRepairApplied: async (
      patches: Array<{ index: number; kind: string; content: unknown }>,
    ) => {
      context.trace.record({
        type: "verification",
        status: "repaired",
        repairedIndexes: patches.map((patch) => patch.index),
      });
      await context.events.emit({
        type: "verification",
        operation: "unit.learning_material",
        status: "repaired",
        repairedIndexes: patches.map((patch) => patch.index),
        patches,
      });
    },
  };
}

export async function executeLearningMaterialAuthoring(
  input: LearningMaterialOperationInput,
  context: OperationExecutionContext,
): Promise<LearningMaterialContent> {
  // One recovery budget per explicit operation. Artifact verification/authoring
  // retries inside this operation all resume the same guided-image budget.
  const imageRepairRetryKey = randomUUID();
  const prepared = prepareSectionMaterialAuthoring({
    prompt: input.prompt,
    policy: input.generationPolicy,
  });
  const outcome = await runArtifactGenerationWorkflow({
    operation: prepared.operation,
    basePrompt: prepared.prompt,
    contextSeed:
      input.artifactContext ??
      defaultArtifactContext(prepared.operation, context),
    contextInvocation: input.contextInvocation,
    executionContext: context,
    author: async (round) => {
      const generated = await streamCourseMaterialItems(round.prompt, {
        componentContext: input.componentContext,
        generationPolicy: input.generationPolicy,
        operation: prepared.operation,
        meta: {
          ...input.meta,
          artifactSequenceId:
            input.artifactContext?.sequenceId ??
            defaultArtifactContext(prepared.operation, context).sequenceId,
          artifactAuthorAttempt: round.attempt,
        },
        contextSubject: input.contextSubject ?? context.subject,
        contextQuery: input.contextQuery,
        contextInvocation: round.invocation,
        signal: context.signal,
        authorItems: input.authoringAgent
            ? ({ prompt, resultSchema, onToken, onPartial, signal }) =>
                runSectionMaterialAuthoringAgent({
                  ...input.authoringAgent!,
                  imageRepairRetryKey,
                  prompt,
                  resultSchema,
                  onToken,
                  onPartial,
                  signal,
                  meta: input.meta,
                })
            : undefined,
        onToken: async (token) => {
          await context.events.emit({
            type: "token",
            operation: prepared.operation,
            token,
          });
        },
        onMaterialUpdate: async (partial) => {
          await context.events.emit({
            type: "partial",
            operation: prepared.operation,
            payload: partial,
          });
        },
      });
      return stripIllustrationBlocksIfDisabled(
        stripLearningMaterialCitationMarkers(generated.material),
      );
    },
    verify: async (candidate) => {
      if (!input.verification) return candidate;
      const events = materialVerificationEvents(context);
      return verifyAndRepairLearningMaterial({
        material: candidate,
        ...input.verification,
        signal: context.signal,
        ...events,
        generationRunId:
          context.purpose === "evaluation"
            ? undefined
            : input.verification.generationRunId,
      });
    },
  });
  if (outcome.status !== "ready") {
    throw new Error("Material artifact workflow returned without a result");
  }
  const material = outcome.artifact;
  await context.events.emit({
    type: "publication_candidate",
    operation: prepared.operation,
    payload: { blockCount: material.blocks.length },
  });
  return material;
}

export const learningMaterialOperation: EvaluableOperation<
  LearningMaterialOperationInput,
  LearningMaterialContent
> = {
  key: "unit.learning_material",
  inputSchema: learningMaterialOperationInputSchema,
  execute: executeLearningMaterialAuthoring,
};

export type SurveyOperationInput = PrepareSurveyAuthoringInput & {
  authoringAgent?: {
    userId: string;
    goalId: string;
    unitId: string;
  };
  componentSelection?: unknown;
  contextSubject?: LearningSystemSubject;
  contextQuery?: string;
  contextInvocation?: unknown;
  meta?: Record<string, unknown>;
  verification?: StructuredVerificationInput;
  artifactContext?: ArtifactContextSeed;
};

/** The authoring input deliberately remains compatible with the existing helper. */
export const surveyOperationInputSchema = z.custom<SurveyOperationInput>();

function surveyVerificationEvents(context: OperationExecutionContext) {
  return {
    onVerificationStart: async () => {
      await context.events.emit({
        type: "verification",
        operation: "unit.sq_preview",
        status: "started",
      });
    },
    onVerificationComplete: async (status: ContentVerificationResult) => {
      context.trace.record({ type: "verification", status });
      await context.events.emit({
        type: "verification",
        operation: "unit.sq_preview",
        status,
      });
    },
    onRepairApplied: async (
      patches: Array<{ index: number; kind: string; content: unknown }>,
    ) => {
      context.trace.record({
        type: "verification",
        status: "repaired",
        repairedIndexes: patches.map((patch) => patch.index),
      });
      await context.events.emit({
        type: "verification",
        operation: "unit.sq_preview",
        status: "repaired",
        repairedIndexes: patches.map((patch) => patch.index),
      });
    },
  };
}

export async function executeSurveyAuthoring(
  input: SurveyOperationInput,
  context: OperationExecutionContext,
): Promise<SqPreview> {
  const prepared = prepareSurveyAuthoring(input);
  const outcome = await runArtifactGenerationWorkflow({
    operation: prepared.operation,
    basePrompt: prepared.prompt,
    contextSeed:
      input.artifactContext ??
      defaultArtifactContext(prepared.operation, context),
    contextInvocation: input.contextInvocation ?? prepared.contextInvocation,
    executionContext: context,
    author: async (round) => {
      const survey =
        input.authoringAgent
          ? await runSurveyAuthoringAgent({
              ...input.authoringAgent,
              authoring: input,
              promptOverride: round.prompt,
              contextSubject: input.contextSubject ?? context.subject,
              contextQuery: input.contextQuery ?? "unit Survey authoring",
              contextInvocation: round.invocation,
              signal: context.signal,
              meta: {
                ...input.meta,
                artifactSequenceId:
                  input.artifactContext?.sequenceId ??
                  defaultArtifactContext(prepared.operation, context)
                    .sequenceId,
                artifactAuthorAttempt: round.attempt,
              },
              onToken: async (token) => {
                await context.events.emit({
                  type: "token",
                  operation: prepared.operation,
                  token,
                });
              },
              onPartial: async (candidate) => {
                const record = candidate as { items?: unknown[] };
                if (!Array.isArray(record?.items)) return;
                await context.events.emit({
                  type: "partial",
                  operation: prepared.operation,
                  payload: { items: record.items },
                });
              },
            })
          : await runValidatedStructuredGeneration<
              SurveyPreviewItem,
              SurveyPreviewItem[],
              SurveyPreview
            >(
              {
                mode: "item-array",
                operation: prepared.operation,
                prompt: round.prompt,
                itemSchema: prepared.itemSchema,
                bindingItemSchema: prepared.bindingItemSchema,
                nativeEnvelopeBindingSchema: prepared.bindingSchema,
                normalizeNativeEnvelopeCandidate:
                  normalizeSurveyPreviewEnvelopeCandidate,
                nativeAttemptLimit: 1,
                resultSchema: prepared.resultSchema,
                assemble: (items) => items,
                assemblePartial: (items) => items,
                recoveryPolicy: {
                  normalizeItem: normalizeGeneratedJsonValue,
                  dedupeExact: true,
                  invalidItems: undefined,
                  missingItems: ({ validItems, sourceItems }) =>
                    missingSqJitItemRepairs(validItems, sourceItems, {
                      minimumOutlineItems:
                        input.sectionPlanningMode === "kacom" ? 2 : 1,
                    }),
                },
                repairContext: `Published learning targets:
${input.canonicalLearningTargetsBlock}

Provider item wire shapes (raw fallback only):
{"kind":"outline","text":"short section title","scope":"one narrow teaching scope","learningTargetIds":["lt_1"],"checkpointAfter":false}
{"kind":"question","question":{"text":"guiding question","learningTargetIds":["lt_1"]}}`,
                contextSubject: input.contextSubject ?? context.subject,
                contextQuery: input.contextQuery,
                contextInvocation: round.invocation,
                meta: {
                  ...input.meta,
                  artifactSequenceId:
                    input.artifactContext?.sequenceId ??
                    defaultArtifactContext(prepared.operation, context)
                      .sequenceId,
                  artifactAuthorAttempt: round.attempt,
                },
              },
              {
                signal: context.signal,
                onToken: async (token) => {
                  await context.events.emit({
                    type: "token",
                    operation: prepared.operation,
                    token,
                  });
                },
                onPartial: async (items) => {
                  await context.events.emit({
                    type: "partial",
                    operation: prepared.operation,
                    payload: { items },
                  });
                },
              },
            );
      return input.componentSelection
        ? withSqComponentSelection(
            survey,
            input.componentSelection as NonNullable<
              SqPreview["componentSelection"]
            >,
          )
        : survey;
    },
    verify: async (candidate) => {
      if (!input.verification) return candidate;
      return verifyAndRepairSurvey({
        survey: candidate,
        ...input.verification,
        signal: context.signal,
        generationRunId:
          context.purpose === "evaluation"
            ? undefined
            : input.verification.generationRunId,
        ...surveyVerificationEvents(context),
      });
    },
  });
  if (outcome.status !== "ready") {
    throw new Error("Survey artifact workflow returned without a result");
  }
  const finalSurvey = outcome.artifact;
  await context.events.emit({
    type: "publication_candidate",
    operation: prepared.operation,
    payload: {
      outlineCount: finalSurvey.survey.outline.length,
      questionCount: finalSurvey.questions.length,
    },
  });
  return finalSurvey;
}

export const surveyOperation: EvaluableOperation<
  SurveyOperationInput,
  SqPreview
> = {
  key: "unit.sq_preview",
  inputSchema: surveyOperationInputSchema,
  execute: executeSurveyAuthoring,
};

export type SectionPlanOperationInput = PrepareSectionPlanAuthoringInput & {
  authoringAgent?: {
    userId: string;
    goalId: string;
    unitId: string;
  };
  contextSubject?: LearningSystemSubject;
  contextQuery?: string;
  contextInvocation?: unknown;
  meta?: Record<string, unknown>;
  artifactContext?: ArtifactContextSeed;
};

export const sectionPlanOperationInputSchema =
  z.custom<SectionPlanOperationInput>();

export async function executeSectionPlanAuthoring(
  input: SectionPlanOperationInput,
  context: OperationExecutionContext,
): Promise<SurveySectionPlanObject> {
  const prepared = prepareSectionPlanAuthoring(input);
  const outcome = await runArtifactGenerationWorkflow({
    operation: prepared.operation,
    basePrompt: prepared.prompt,
    contextSeed:
      input.artifactContext ??
      defaultArtifactContext(prepared.operation, context),
    contextInvocation: input.contextInvocation ?? prepared.contextInvocation,
    executionContext: context,
    author: async (round) =>
      input.authoringAgent
        ? runSectionPlanAuthoringAgent({
            ...input.authoringAgent,
            authoring: {
              unitTitle: input.unitTitle,
              outline: input.outline,
              questions: input.questions,
              languageBlock: input.languageBlock,
            },
            signal: context.signal,
            meta: {
              ...input.meta,
              artifactSequenceId:
                input.artifactContext?.sequenceId ??
                defaultArtifactContext(prepared.operation, context).sequenceId,
              artifactAuthorAttempt: round.attempt,
            },
          })
        : runValidatedStructuredGeneration(
            {
              mode: "object",
              schema: prepared.resultSchema,
              prompt: round.prompt,
              options: {
                operation: prepared.operation,
                bindingSchema: compactSurveySectionPlanBindingSchema,
                meta: {
                  ...input.meta,
                  artifactSequenceId:
                    input.artifactContext?.sequenceId ??
                    defaultArtifactContext(prepared.operation, context)
                      .sequenceId,
                  artifactAuthorAttempt: round.attempt,
                },
              },
              contextSubject: input.contextSubject ?? context.subject,
              contextQuery: input.contextQuery,
              contextInvocation: round.invocation,
            },
            { signal: context.signal },
          ),
    verify: async (candidate) => prepared.resultSchema.parse(candidate),
  });
  if (outcome.status !== "ready") {
    throw new Error("Section-plan artifact workflow returned without a result");
  }
  const plan = outcome.artifact;
  await context.events.emit({
    type: "publication_candidate",
    operation: prepared.operation,
    payload: { sectionCount: plan.sections.length },
  });
  return plan;
}

export const sectionPlanOperation: EvaluableOperation<
  SectionPlanOperationInput,
  SurveySectionPlanObject
> = {
  key: "unit.section_plan",
  inputSchema: sectionPlanOperationInputSchema,
  execute: executeSectionPlanAuthoring,
};

let registered = false;

/** Registration is intentionally separate from the canonical routing catalog. */
export function registerStructuredOperationAdapters(): void {
  if (registered) return;
  registerOperationAdapter(learningMaterialOperation);
  registerOperationAdapter(surveyOperation);
  registerOperationAdapter(sectionPlanOperation);
  registered = true;
}
