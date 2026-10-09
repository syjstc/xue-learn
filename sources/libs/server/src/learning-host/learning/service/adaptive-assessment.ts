import { BadRequestException, NotFoundException } from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import type {
  LearnerStateMemoryInvalidationRepository,
  TaskAttemptRepository,
  PrerequisiteBridgeRepository,
  VerifiedAssessmentCompletionRepository,
  VerifiedEvidenceContextDistance,
  VerifiedEvidenceSource,
  VerifiedEvidenceTaskKind,
} from "../../../../../domain/src/index.js";
import {
  startTaskAttempt,
  type AssistanceLevel,
} from "../../../cognition/index.js";
import { invalidateAgendaForUser } from "../../../agenda/index.js";
import { invalidateLearnerStateMemory } from "../../../learner-state-memory/index.js";
import { runValidatedStructuredGeneration } from "../../../llm/validated-structured-generation.js";
import { createSseStream, sseResponse } from "../../../llm/sse.js";
import { resolveAdaptiveEvaluatorAuthority } from "../../../assessment/index.js";
import {
  adaptiveEvaluatorOutputSchema,
  assertAdaptiveEvaluatorBinding,
  normalizeAdaptiveEvaluatorContextDistance,
  prepareAdaptiveEvaluator,
} from "../../../assessment/index.js";

const ADAPTIVE_EVALUATOR_AUTHORITY =
  resolveAdaptiveEvaluatorAuthority("rubric_llm_v1");

const evaluationSchema = adaptiveEvaluatorOutputSchema;

export type AdaptiveAssessmentSubmitBody = {
  response?: unknown;
  durationMs?: unknown;
  idempotencyKey?: unknown;
  assistanceTrace?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonObject(value: unknown): Record<string, unknown> {
  const response = record(value);
  if (JSON.stringify(response).length > 100_000) {
    throw new BadRequestException(
      tBackend("error.learning.assessmentResponseTooLarge"),
    );
  }
  return response;
}

function assistance(value: unknown): {
  trace: Record<string, unknown>[];
  level: AssistanceLevel;
  hintCount: number;
  answerRevealed: boolean;
} {
  const trace = Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item != null && typeof item === "object" && !Array.isArray(item),
      )
    : [];
  const levels = trace.flatMap((item) =>
    typeof item.level === "string" ? [item.level] : [],
  );
  const answerRevealed = levels.includes("answer_revealed");
  const level: AssistanceLevel = answerRevealed
    ? "answer_revealed"
    : levels.includes("worked_example")
      ? "worked_example"
      : levels.includes("guided")
        ? "guided"
        : levels.includes("light_hint")
          ? "light_hint"
          : "independent";
  return {
    trace,
    level,
    hintCount:
      level === "light_hint" || level === "guided"
        ? Math.max(1, trace.length)
        : 0,
    answerRevealed,
  };
}

function criterionRef(value: unknown): string {
  const ref = record(value).ref;
  if (typeof ref !== "string" || !ref.trim()) {
    throw new Error("Adaptive task has an invalid rubric criterion");
  }
  return ref;
}

export function assertAdaptiveAssessmentSubmitBody(
  body: Record<string, unknown>,
) {
  const allowed = new Set([
    "response",
    "durationMs",
    "idempotencyKey",
    "assistanceTrace",
  ]);
  const forbidden = Object.keys(body).filter((key) => !allowed.has(key));
  if (forbidden.length > 0) {
    throw new BadRequestException(
      tBackend("error.learning.evaluatorFieldsUnsupported", {
        fields: forbidden.join(", "),
      }),
    );
  }
  if (
    typeof body.idempotencyKey !== "string" ||
    !body.idempotencyKey.trim() ||
    body.idempotencyKey.length > 200
  ) {
    throw new BadRequestException(
      tBackend("error.learning.idempotencyKeyRequired"),
    );
  }
  if (
    !Number.isInteger(body.durationMs) ||
    Number(body.durationMs) <= 0 ||
    Number(body.durationMs) > 2 * 60 * 60 * 1000
  ) {
    throw new BadRequestException(
      tBackend("error.learning.assessmentDurationInvalid"),
    );
  }
  return {
    response: jsonObject(body.response),
    durationMs: Number(body.durationMs),
    idempotencyKey: body.idempotencyKey.trim(),
    assistance: assistance(body.assistanceTrace),
  };
}

export async function submitAdaptiveAssessmentStream(
  compatibilityClient: unknown,
  userId: string,
  taskId: string,
  rawBody: Record<string, unknown>,
  verifiedAssessmentCompletion?: VerifiedAssessmentCompletionRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  taskAttempt?: TaskAttemptRepository,
  prerequisiteBridge?: PrerequisiteBridgeRepository,
) {
  const body = assertAdaptiveAssessmentSubmitBody(rawBody);
  if (!taskAttempt || !verifiedAssessmentCompletion || !prerequisiteBridge) {
    throw new Error("Adaptive-assessment persistence is not configured");
  }
  const task = await taskAttempt.findAdaptiveAssessmentTask({ userId, taskId });
  if (!task)
    throw new NotFoundException(
      tBackend("error.learning.adaptiveAssessmentNotFound"),
    );
  if (task.requirements.length !== 1) {
    throw new Error("Adaptive item must have one primary requirement");
  }
  const requirement = task.requirements[0]!;
  const learningTargetId = requirement.learningTargetId;
  if (!learningTargetId) {
    throw new Error("Adaptive item must bind one learning target");
  }
  const ref = criterionRef(requirement.rubricCriterion);

  return sseResponse(
    createSseStream(async (send) => {
      send({
        type: "status",
        phase: "assessment_submit",
        message: tBackend("status.learning.savingAnswer"),
      });
      const now = new Date();
      const attemptInput = {
        taskId,
        userId,
        unitId: task.unitId ?? undefined,
        idempotencyKey: `adaptive:${userId}:${body.idempotencyKey}`,
        response: body.response,
        assistanceTrace: body.assistance.trace,
        assistance: {
          level: body.assistance.level,
          hintCount: body.assistance.hintCount,
          answerRevealed: body.assistance.answerRevealed,
        },
        durationMs: body.durationMs,
        status: "submitted" as const,
        submittedAt: now,
        positiveEvidenceEligible: !body.assistance.answerRevealed,
      };
      const attemptResult = await startTaskAttempt(
        compatibilityClient as never,
        attemptInput,
        taskAttempt,
      );
      if (
        attemptResult.replayed &&
        JSON.stringify(attemptResult.attempt.response) !==
          JSON.stringify(body.response)
      ) {
        throw new BadRequestException(
          tBackend("error.learning.idempotencyConflict"),
        );
      }
      const existing = await taskAttempt.findObservation({
        attemptId: attemptResult.attempt.id,
        requirementId: requirement.id,
      });
      if (existing) {
        send({
          type: "done",
          taskId,
          attemptId: attemptResult.attempt.id,
          replayed: true,
          score: existing.score,
        });
        return;
      }

      send({
        type: "status",
        phase: "assessment_evaluation",
        message: tBackend("status.learning.verifyingRubric"),
      });
      const promptInvocation = {
        goalTitle: task.goalTitle,
        task: {
          title: task.title,
          instructions: task.instructions,
          rubric: task.rubric,
        },
        requirement: {
          id: requirement.id,
          learningTargetId,
          cognitiveEntityId: requirement.cognitiveEntityId,
          dimension: requirement.dimension,
        },
        criterionRef: ref,
        response: body.response,
      };
      const preparedEvaluator = prepareAdaptiveEvaluator(promptInvocation);
      const evaluated = await runValidatedStructuredGeneration({
        mode: "object",
        schema: evaluationSchema,
        prompt: preparedEvaluator.prompt,
        options: {
          operation: "assessment.adaptive.evaluate",
          bindingSchema: evaluationSchema,
          schemaShape:
            '{"requirementId":"...","cognitiveEntityId":"...","learningTargetId":"...","dimension":"application","criterionRef":"...","score":0.0,"contextNoveltyVerified":false,"rationale":"..."}',
          meta: {
            userId,
            goalId: task.goalId,
            taskId,
            assessmentPolicyVersion: 2,
          },
        },
        contextInvocation: promptInvocation,
        contextSubject: {
          userId,
          goalId: task.goalId,
          unitId: task.unitId ?? undefined,
        },
        contextQuery:
          "Evaluate this submitted adaptive assessment against its immutable published requirement.",
      });
      assertAdaptiveEvaluatorBinding(evaluated, {
        requirementId: requirement.id,
        learningTargetId,
        cognitiveEntityId: requirement.cognitiveEntityId,
        dimension: requirement.dimension,
        criterionRef: ref,
      });
      const evaluatorRunId = `adaptive:${attemptResult.attempt.id}:v1`;
      const completedAt = new Date();
      const candidate = {
        requirementId: requirement.id,
        score: evaluated.score,
        evaluatorRunId,
        assertedLearningTargetId: evaluated.learningTargetId,
        assertedCognitiveEntityId: evaluated.cognitiveEntityId,
        assertedDimension: evaluated.dimension,
        assertedCriterionRef: evaluated.criterionRef,
        rawResult: { rationale: evaluated.rationale },
        metadata: {
          assessmentItemKind: record(record(task.context).assessmentItem).type,
          assessmentPolicyVersion: 2,
          contextDistance: normalizeAdaptiveEvaluatorContextDistance(
            record(record(task.context).assessmentEvidenceSlot)
              .contextDistance as "same" | "near" | "far",
            evaluated.contextNoveltyVerified,
          ),
          contextNoveltyVerified: evaluated.contextNoveltyVerified,
        },
      };
      const domainEvent = {
        type: "assessment.answer_verified",
        idempotencyKey: `assessment.answer_verified:${attemptResult.attempt.id}:${requirement.id}`,
        payload: {
          attemptId: attemptResult.attempt.id,
          taskId,
          requirementId: requirement.id,
          learningTargetId,
          cognitiveEntityId: requirement.cognitiveEntityId,
          dimension: requirement.dimension,
        },
      };
      const evidencePolicy = record(record(task.context).evidencePolicy);
      const ormEvaluator = {
        ...ADAPTIVE_EVALUATOR_AUTHORITY,
        source: evidencePolicy.source as VerifiedEvidenceSource,
        taskKind: evidencePolicy.taskKind as VerifiedEvidenceTaskKind,
        contextKey: String(evidencePolicy.contextKey ?? ""),
        contextDistance:
          evidencePolicy.contextDistance as VerifiedEvidenceContextDistance,
      };
      const observation = await verifiedAssessmentCompletion.complete({
        userId,
        goalId: task.goalId,
        unitId: task.unitId ?? undefined,
        taskId,
        attemptId: attemptResult.attempt.id,
        completedAt,
        candidate,
        evaluator: ormEvaluator,
        domainEvent,
      });
      await invalidateLearnerStateMemory(
        userId,
        "verified_assessment_completed",
        undefined,
        learnerStateMemoryInvalidation,
      );
      const bridgeUnitId =
        record(task.context).assessmentPurpose === "readiness" && task.moduleId
          ? await prerequisiteBridge.sync({
              userId,
              goalId: task.goalId,
              moduleId: task.moduleId,
              triggerAttemptId: attemptResult.attempt.id,
            })
          : null;
      await invalidateAgendaForUser(userId);
      send({
        type: "done",
        taskId,
        attemptId: attemptResult.attempt.id,
        replayed: observation.replayed,
        score: evaluated.score,
        rationale: evaluated.rationale,
        bridgeUnitId,
      });
    }),
  );
}
