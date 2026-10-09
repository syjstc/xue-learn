import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import type {
  AssessmentTargetRepository,
  ModuleDiagnosticCompletionRepository,
  ModuleDiagnosticReadRepository,
  ModuleTestOutRepository,
  LearnerStateMemoryInvalidationRepository,
} from "../../../../../domain/src/index.js";
import {
  assessLearningTargetsFromState,
  buildModuleDiagnosticEvidenceBatch,
  decideModuleDiagnosticSubmission,
  isCriticalLearningTarget,
  learningTargetCompetencyBlock,
  planModuleDiagnosticGeneration,
  scoreQuizByLearningTarget,
  type AssessmentLearnerEntityState,
  type UnitAssessmentTarget,
} from "../../../assessment/index.js";
import { invalidateAgendaForUser } from "../../../agenda/index.js";
import { invalidateLearnerStateMemory } from "../../../learner-state-memory/index.js";
import { createTrackedTokenHandler } from "../../../generation/token-handler.js";
import { handleTrackedStreamPost } from "../../../generation/tracked-sse.js";
import { gradeQuiz } from "../../../graph/unit-session.js";
import { streamGenerateDiagnosticQuiz } from "../../../graph/unit-session-stream.js";
import type { QuizQuestion } from "../../../llm/schemas.js";

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}

async function requireReadyModule(
  userId: string,
  goalId: string,
  moduleId: string,
  diagnosticRead: ModuleDiagnosticReadRepository,
) {
  const module = await diagnosticRead.findModule({ userId, goalId, moduleId });
  if (!module)
    throw new NotFoundException(tBackend("error.learning.moduleNotFound"));
  if (module.unlockStatus === "locked" || module.generationStatus !== "ready") {
    throw new ConflictException({
      code:
        module.unlockStatus === "locked"
          ? "MODULE_LOCKED"
          : "MODULE_GENERATING",
      message:
        module.unlockStatus === "locked"
          ? tBackend("error.goal.moduleLocked")
          : tBackend("error.goal.moduleBuilding"),
    });
  }
  return module;
}

function mutableTargets(
  targets: Awaited<ReturnType<AssessmentTargetRepository["findForModule"]>>,
): UnitAssessmentTarget[] {
  return targets.map((target) => ({
    ...target,
    assessmentCriteria: target.assessmentCriteria.map((criterion) => ({
      ...criterion,
    })),
    requirements: target.requirements.map((requirement) => ({
      ...requirement,
    })),
  }));
}

type ModuleDiagnosticResponse = {
  answers?: Record<string, string | number | boolean | number[]>;
  results?: unknown[];
  overallScore?: number;
  passed?: boolean;
  perCapability?: Array<{
    learningTargetId: string;
    title: string;
    score: number;
    passed: boolean;
  }>;
};

function questionsFromJson(value: unknown): QuizQuestion[] {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  const questions = (parsed as { questions?: QuizQuestion[] } | null)
    ?.questions;
  return Array.isArray(questions) ? questions : [];
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function assertReadyModuleStatus(module: {
  unlockStatus: string;
  generationStatus: string;
}) {
  if (module.unlockStatus === "locked" || module.generationStatus !== "ready") {
    throw new ConflictException({
      code:
        module.unlockStatus === "locked"
          ? "MODULE_LOCKED"
          : "MODULE_GENERATING",
      message:
        module.unlockStatus === "locked"
          ? tBackend("error.goal.moduleLocked")
          : tBackend("error.goal.moduleBuilding"),
    });
  }
}

export async function getModuleDiagnostic(
  compatibilityClient: unknown,
  userId: string,
  goalId: string,
  moduleId: string,
  diagnosticRead?: ModuleDiagnosticReadRepository,
  assessmentTarget?: AssessmentTargetRepository,
) {
  if (!diagnosticRead || !assessmentTarget) {
    throw new Error("Module diagnostic persistence is not configured");
  }
  const module = await requireReadyModule(userId, goalId, moduleId, diagnosticRead);
  assertReadyModuleStatus(module);

  const targets = mutableTargets(
    await assessmentTarget.findForModule({ userId, moduleId, role: "exit" }),
  );
  const latestTask = module.latestTask;
  const latestAttempt = module.latestAttempt;
  const submitted =
    latestAttempt?.status === "evaluated" ||
    latestAttempt?.status === "submitted";
  const response = submitted
    ? (parseJsonValue(latestAttempt.response ?? {}) as ModuleDiagnosticResponse)
    : null;
  return {
    eligible: module.unlockStatus === "unlocked",
    moduleStatus: module.unlockStatus,
    completionMethod: module.completionMethod,
    thresholds: { overall: 0.85, perCapability: 0.7 },
    capabilities: targets.map((target) => ({
      ...target,
      criticalCompletionGate: isCriticalLearningTarget(target),
    })),
    latestAttempt: latestTask
      ? {
          // In-progress diagnostics are keyed by LearningTask id so submit can
          // create the immutable TaskAttempt response in one insert.
          id: submitted && latestAttempt ? latestAttempt.id : latestTask.id,
          status: submitted ? ("submitted" as const) : ("ready" as const),
          questions: questionsFromJson(
            latestAttempt?.context ?? latestTask.context,
          ),
          overallScore: response?.overallScore ?? null,
          passed: response?.passed ?? null,
          perLearningTargetResults: response?.perCapability ?? [],
          response: parseJsonValue(latestAttempt?.response ?? {}),
          startedAt: (
            latestAttempt?.startedAt ?? latestTask.createdAt
          ).toISOString(),
          submittedAt: latestAttempt?.submittedAt?.toISOString() ?? null,
        }
      : null,
  };
}

export function streamModuleDiagnostic(
  _compatibilityClient: unknown,
  userId: string,
  goalId: string,
  moduleId: string,
  body: { runId?: string } = {},
  diagnosticRead?: ModuleDiagnosticReadRepository,
  moduleDiagnosticCompletion?: ModuleDiagnosticCompletionRepository,
  assessmentTarget?: AssessmentTargetRepository,
) {
  if (!diagnosticRead || !moduleDiagnosticCompletion || !assessmentTarget) {
    throw new Error("Module diagnostic persistence is not configured");
  }
  return handleTrackedStreamPost(
    { runId: body.runId },
    {
      scope: "module",
      scopeId: moduleId,
      operation: "module.diagnostic",
    },
    async (ctx) => {
      const module = await requireReadyModule(
        userId,
        goalId,
        moduleId,
        diagnosticRead,
      );
      if (module.unlockStatus === "completed") {
        await ctx.send({
          type: "error",
          message: tBackend("error.learning.moduleAlreadyCompleted"),
        });
        return;
      }
      const targets = mutableTargets(
        await assessmentTarget.ensureQuizAssessableForModule({
          userId,
          moduleId,
        }),
      );
      const diagnosticPlan = planModuleDiagnosticGeneration({ targets });
      if (!diagnosticPlan.ready) {
        await ctx.send({
          type: "error",
          message:
            diagnosticPlan.reason === "no_critical_targets"
              ? tBackend("error.learning.noModuleDiagnosticTargets")
              : tBackend("error.learning.moduleDiagnosticInsufficient"),
        });
        return;
      }
      const {
        criticalTargets,
        selectedTargets: selected,
        questionCount,
      } = diagnosticPlan;
      await ctx.send({
        type: "status",
        phase: "diagnostic",
        message: tBackend("status.generation.diagnostic", {
          count: questionCount,
        }),
      });
      const onToken = createTrackedTokenHandler(ctx);
      const quiz = await streamGenerateDiagnosticQuiz(
        {
          id: module.goalId,
          title: module.goalTitle,
          contentLanguage: module.goalContentLanguage,
          level: module.goalLevel,
          generationOptions: module.goalGenerationOptions,
          goalKind: module.goalKind,
          userId: module.goalUserId,
        },
        module.title,
        learningTargetCompetencyBlock(selected),
        questionCount,
        selected.map((target) => target.localRef),
        onToken,
        ctx.signal,
        async (partial) => {
          if (!ctx.signal.aborted) {
            await ctx.send({
              type: "quiz_partial",
              questions: partial.questions,
              completeQuestionCount: partial.completeQuestionCount,
              placeholderQuestionCount: partial.placeholderQuestionCount,
            });
          }
        },
        "module",
        selected,
        {
          onVerificationStart: async () => {
            await ctx.send({
              type: "status",
              phase: "diagnostic",
              message: tBackend("status.generation.verifyingContent"),
            });
            await ctx.send({
              type: "content_verification",
              state: "verifying",
              artifactKind: "assessment",
            });
          },
          onRepairApplied: (patches) =>
            ctx.send({
              type: "content_repair",
              artifactKind: "assessment",
              patches,
            }),
          onVerificationComplete: (result) =>
            ctx.send({
              type: "content_verification",
              state: "verified",
              artifactKind: "assessment",
              result,
            }),
          generationRunId: ctx.runId,
        },
      );
      // Persist the quiz on LearningTask only. TaskAttempt.response is immutable,
      // so the evaluated attempt is created once at submit with answers baked in.
      const task = await moduleDiagnosticCompletion.publishMainTask({
          userId,
          goalId,
          moduleId,
          stableKey: `module:${module.curriculumKey}:diagnostic:${stableHash(
            quiz.questions,
          )}:${Date.now()}`,
          title: tBackend("label.learning.moduleExitDiagnostic", {
            title: module.title,
          }),
          instructions:
            "Closed-book module exit diagnostic. Server scoring owns completion.",
          context: {
            questions: quiz.questions,
            thresholds: { overall: 0.85, perCapability: 0.7 },
            criticalLearningTargetIds: criticalTargets.map(
              (target) => target.id,
            ),
          },
          rubric: {
            overallThreshold: 0.85,
            everyCriticalCapabilityGate: true,
          },
      });
      await ctx.send({
        type: "done",
        attemptId: task.id,
        questions: quiz.questions,
        capabilities: selected,
        thresholds: { overall: 0.85, perCapability: 0.7 },
      });
    },
  );
}

export async function submitModuleDiagnostic(
  _compatibilityClient: unknown,
  userId: string,
  goalId: string,
  moduleId: string,
  attemptId: string,
  answers: Record<string, string | number | boolean | number[]>,
  moduleTestOut?: ModuleTestOutRepository,
  moduleDiagnosticCompletion?: ModuleDiagnosticCompletionRepository,
  diagnosticRead?: ModuleDiagnosticReadRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  assessmentTarget?: AssessmentTargetRepository,
) {
  if (
    !diagnosticRead ||
    !moduleDiagnosticCompletion ||
    !moduleTestOut ||
    !assessmentTarget
  ) {
    throw new Error("Module diagnostic persistence is not configured");
  }
  const module = await requireReadyModule(
    userId,
    goalId,
    moduleId,
    diagnosticRead,
  );
  assertReadyModuleStatus(module);
  if (module.unlockStatus === "completed") {
    throw new BadRequestException(
      tBackend("error.learning.moduleAlreadyCompleted"),
    );
  }

  // New flow returns LearningTask.id as attemptId. Older in-flight streams may
  // still hold a started TaskAttempt id — accept both.
  const submission = await diagnosticRead.findSubmission({
    userId,
    goalId,
    moduleId,
    attemptId,
  });
  const taskRead = submission?.task ?? null;
  const legacyAttempt = submission?.legacyAttempt ?? null;
  const task = taskRead
    ? {
        id: taskRead.id,
        context: parseJsonValue(taskRead.context),
      }
    : null;
  if (!task)
    throw new NotFoundException(tBackend("error.learning.assessmentNotFound"));
  if (legacyAttempt && legacyAttempt.status !== "started") {
    throw new BadRequestException(
      tBackend("error.learning.assessmentAlreadySubmitted"),
    );
  }

  const existingEvaluated = submission?.existingEvaluatedAttemptId
    ? { id: submission.existingEvaluatedAttemptId }
    : null;
  if (existingEvaluated) {
    throw new BadRequestException(
      tBackend("error.learning.assessmentAlreadySubmitted"),
    );
  }

  const context = (parseJsonValue(legacyAttempt?.context) ?? task.context) as {
    questions?: QuizQuestion[];
    criticalLearningTargetIds?: string[];
  };
  const questions = Array.isArray(context?.questions) ? context.questions : [];
  if (questions.length === 0) {
    throw new BadRequestException(
      tBackend("error.learning.assessmentQuestionNotFound"),
    );
  }
  const targets = mutableTargets(
    await assessmentTarget.findForModule({ userId, moduleId, role: "exit" }),
  );
  const graded = await gradeQuiz(questions, answers);

  const now = new Date();
    const evidenceSubmissionId = `module-diagnostic:${task.id}:${userId}`;
    const batch = buildModuleDiagnosticEvidenceBatch({
      goalId,
      moduleId,
      activityAttemptId: evidenceSubmissionId,
      questions,
      results: graded.results,
      answers,
      targets,
      submittedAt: now,
    });
    const completion = await moduleDiagnosticCompletion.complete({
      userId,
      goalId,
      moduleId,
      mainTaskId: task.id,
      legacyAttemptId: legacyAttempt?.id,
      mainAttemptIdempotencyKey: evidenceSubmissionId,
      mainResponseContext: { answers, results: graded.results },
      tasks: batch.tasks,
      completions: batch.completions,
      submittedAt: now,
      startedAt: legacyAttempt?.startedAt ?? now,
      finalize: async ({ states }) => {
        const stateFor = async (
          entityId: string,
        ): Promise<AssessmentLearnerEntityState> => {
          const state = states.get(entityId);
          return {
            overallEstimate: state?.estimate ?? null,
            evidenceSufficiency: state?.evidenceSufficiency ?? 0,
            status: state?.status ?? "unobserved",
            inferencePolicyVersion: state?.inferenceVersion ?? 1,
            stateRevision: 0,
            evidenceCutoffAt: null,
            lifecycleCutoffAt: null,
            dimensions: (state?.dimensions ?? []).map((dimension) => ({
              dimension: dimension.dimension,
              estimate: dimension.estimate,
              evidenceSufficiency: dimension.evidenceSufficiency,
              evidenceSufficiencyReasons: dimension.evidenceSufficiencyReasons,
              status: dimension.status,
              effectiveEvidenceWeight: dimension.evidenceWeight,
              lastObservedAt: dimension.lastObservedAt?.toISOString() ?? null,
            })),
          };
        };
        const cognitiveAssessments = await assessLearningTargetsFromState({
          targets,
          stateFor,
        });
        const performance = scoreQuizByLearningTarget({
          questions,
          results: graded.results,
          targets,
        }).perLearningTarget;
        const decision = decideModuleDiagnosticSubmission({
          overallScore: graded.score,
          targets,
          performance,
          cognitiveAssessments,
        });
        return {
          responseJson: JSON.stringify({
            answers,
            results: graded.results,
            overallScore: graded.score,
            passed: decision.passed,
            perCapability: decision.perCapability,
          }),
          overallScore: decision.overallScore,
          passed: decision.passed,
          perCapabilityResultsJson: JSON.stringify(decision.perCapability),
          submittedAt: now,
        };
      },
    });
  const result: {
    passed: boolean;
    perCapability: Array<{
      learningTargetId: string;
      title: string;
      score: number;
      passed: boolean;
    }>;
    attemptId: string;
  } = {
    passed: completion.finalization.passed,
    perCapability: JSON.parse(
      completion.finalization.perCapabilityResultsJson,
    ),
    attemptId: completion.attempt.id,
  };

  let moduleCompletion: Awaited<
    ReturnType<ModuleTestOutRepository["completeOwned"]>
  > | null = null;
  if (result.passed) {
    moduleCompletion = await moduleTestOut.completeOwned({
      userId,
      goalId,
      moduleId,
      attemptId: result.attemptId,
    });
  }
  await invalidateLearnerStateMemory(
    userId,
    "module_diagnostic_completed",
    undefined,
    learnerStateMemoryInvalidation,
  );
  await invalidateAgendaForUser(userId);
  return {
    attemptId: result.attemptId,
    overallScore: graded.score,
    passed: result.passed,
    perCapabilityResults: result.perCapability,
    results: graded.results,
    weakCapabilities: result.perCapability
      .filter((capability) => !capability.passed)
      .map((capability) => capability.title),
    nextModuleId: moduleCompletion?.nextModuleId ?? null,
    completionMethod: moduleCompletion?.completionMethod ?? null,
  };
}
