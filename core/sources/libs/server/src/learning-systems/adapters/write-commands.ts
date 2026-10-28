import type {
  LearnerStateMemoryInvalidationRepository,
  VerifiedEvidenceAppendRepository,
  VerifiedObservationCandidate,
  VerifiedObservationEvaluatorPolicy,
} from "../../../../domain/src/index.js";
import type {
  LearningSystemCapability,
  SystemCommand,
  SystemCommandResult,
  TransactionContext,
} from "../types.js";
import { z } from "zod";

export const KACOM_RECORD_VERIFIED_ASSESSMENT_COMMAND =
  "kacom.record_verified_assessment";

const cognitiveDimensionSchema = z.enum([
  "memory",
  "understanding",
  "application",
  "transfer",
  "fluency",
  "stability",
  "independence",
]);

const jsonObjectSchema = z.record(z.string(), z.unknown());

const recordVerifiedAssessmentPayloadSchema = z
  .object({
    attemptId: z.string().trim().min(1),
    candidate: z
      .object({
        requirementId: z.string().trim().min(1),
        score: z.number().finite().min(0).max(1),
        outcome: z.string().optional(),
        rawResult: jsonObjectSchema.optional(),
        metadata: jsonObjectSchema.optional(),
        observedAt: z.date().optional(),
        evaluatorRunId: z.string().trim().min(1),
        assertedCognitiveEntityId: z.string().trim().min(1).optional(),
        assertedLearningTargetId: z.string().trim().min(1).optional(),
        assertedDimension: cognitiveDimensionSchema.optional(),
        assertedCriterionRef: z.string().trim().min(1).optional(),
        assertedDefinitionVersion: z.number().int().positive().optional(),
      })
      .strict(),
    evaluator: z
      .object({
        source: z.enum([
          "quiz",
          "diagnostic",
          "review_quiz",
          "flashcard",
          "feynman",
          "socratic",
          "practice",
          "project",
          "teaching",
          "human_observation",
        ]),
        taskKind: z.enum([
          "recall",
          "explanation",
          "routine_application",
          "novel_application",
          "integration",
          "project",
          "teaching",
          "retention",
        ]),
        contextKey: z.string().trim().min(1),
        contextDistance: z.enum(["same", "near", "far"]),
        delayedDays: z.number().int().nonnegative().optional(),
        rubricId: z.string().trim().min(1).optional(),
        evaluatorType: z.enum(["deterministic", "llm", "human", "self"]),
        evaluatorRef: z.string().trim().min(1).optional(),
        contextLineageKey: z.string().trim().min(1).optional(),
        evaluatorReliability: z.number().finite().min(0).max(1),
        groundingReliability: z.number().finite().min(0).max(1),
        evidenceStrength: z
          .enum(["weak", "moderate", "strong", "decisive"])
          .optional(),
      })
      .strict(),
  })
  .strict();

export type RecordVerifiedAssessmentCommandPayload = {
  attemptId: string;
  candidate: VerifiedObservationCandidate;
  evaluator: VerifiedObservationEvaluatorPolicy;
};

export type AttachKacomWriteCommandsOptions = {
  verifiedEvidenceAppend: VerifiedEvidenceAppendRepository;
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository;
};

async function handleRecordVerifiedAssessment(
  command: SystemCommand,
  verifiedEvidenceAppend: VerifiedEvidenceAppendRepository,
  transaction?: TransactionContext,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
): Promise<SystemCommandResult> {
  const userId = command.subject.userId?.trim();
  if (!userId) {
    throw new Error(
      `${KACOM_RECORD_VERIFIED_ASSESSMENT_COMMAND} requires a user subject`,
    );
  }
  const payload = recordVerifiedAssessmentPayloadSchema.parse(
    command.payload,
  ) as RecordVerifiedAssessmentCommandPayload;
  if (
    command.idempotencyKey &&
    command.idempotencyKey !== payload.candidate.evaluatorRunId
  ) {
    throw new Error(
      `${KACOM_RECORD_VERIFIED_ASSESSMENT_COMMAND} idempotency key must match evaluatorRunId`,
    );
  }

  if (transaction) {
    throw new Error(
      `${KACOM_RECORD_VERIFIED_ASSESSMENT_COMMAND} owns its transaction and cannot join an opaque command transaction`,
    );
  }
  const result = await verifiedEvidenceAppend.recordVerifiedObservation({
    userId,
    attemptId: payload.attemptId,
    candidate: payload.candidate,
    evaluator: payload.evaluator,
  });
  await learnerStateMemoryInvalidation?.invalidate(
    userId,
    "verified_assessment_completed",
  );
  return {
    handledBy: "kacom",
    value: result,
  };
}

/**
 * Adds KACOM-owned write commands to the existing KACOM read adapter. Keeping
 * one capability manifest avoids ambiguous ownership and duplicate registry
 * IDs while persistence remains in its current module.
 */
export function attachKacomWriteCommands(
  capabilities: readonly LearningSystemCapability[],
  options: AttachKacomWriteCommandsOptions,
): LearningSystemCapability[] {
  let attached = false;
  const decorated = capabilities.map((capability) => {
    if (capability.manifest.id !== "kacom") return capability;
    if (attached) {
      throw new Error("Cannot attach KACOM commands to duplicate capabilities");
    }
    attached = true;
    const previousHandler = capability.handleCommand;
    return {
      ...capability,
      manifest: {
        ...capability.manifest,
        acceptsCommands: [
          ...new Set([
            ...(capability.manifest.acceptsCommands ?? []),
            KACOM_RECORD_VERIFIED_ASSESSMENT_COMMAND,
          ]),
        ],
      },
      handleCommand: async (command, transaction) => {
        if (command.type === KACOM_RECORD_VERIFIED_ASSESSMENT_COMMAND) {
          return handleRecordVerifiedAssessment(
            command,
            options.verifiedEvidenceAppend,
            transaction,
            options.learnerStateMemoryInvalidation,
          );
        }
        if (previousHandler) return previousHandler(command, transaction);
        throw new Error(`Unsupported KACOM command "${command.type}"`);
      },
    } satisfies LearningSystemCapability;
  });
  if (!attached) {
    throw new Error(
      "Cannot attach KACOM commands: capability is not registered",
    );
  }
  return decorated;
}
