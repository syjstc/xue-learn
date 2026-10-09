import { BadRequestException, NotFoundException } from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import {
  type AssessmentTargetRepository,
  type CognitiveModelPresentationReadRepository,
  isUnitLearningDone,
  type CognitiveModelGenerationRunRepository,
  type CognitiveModelPublicationRepository,
  type CognitiveModelPublicationFinalizationRepository,
  type ProjectBlueprintRepository,
  type UnitDiagnosticReadRecord,
  type UnitDiagnosticReadRepository,
  type UnitCompletionRepository,
  type CompletedUnitKnowledgeReadRepository,
  type UnitCompletionReadRepository,
  type CognitiveModelEventRepository,
  type UnitDiagnosticCompletionRepository,
  type LearnerStateMemoryInvalidationRepository,
  type DiagnosticRemediationRepository,
  type LearnerStateProjectionReadRepository,
} from "../../../../../domain/src/index.js";
import {
  invalidateAgendaForUser,
  markAgendaItemCompletedForUnit,
} from "../../../agenda/index.js";
import { completeUnit, gradeQuiz } from "../../../graph/unit-session.js";
import { getUnitLearningTargetsV2 } from "../../../cognitive-model/index.js";
import { invalidateLearnerStateMemory } from "../../../learner-state-memory/index.js";
import { type QuizQuestion } from "../../../llm/schemas.js";
import { parseJson } from "../../../utils.js";
import {
  assessLearningTargetsFromState,
  buildUnitDiagnosticEvidenceBatch,
  decideUnitDiagnosticSubmission,
  isCriticalLearningTarget,
  evaluateUnitDiagnosticEligibility,
  planUnitDiagnosticGeneration,
  scoreQuizByLearningTarget,
  type AssessmentLearnerEntityState,
  type UnitDiagnosticDecision,
  type UnitDiagnosticTargetResult,
  type UnitAssessmentTarget,
} from "../../../assessment/index.js";

import { assertUnitAssessmentReady } from "./helpers/assessment-gate.js";

async function readDiagnosticUnit(
  userId: string,
  unitId: string,
  repository: UnitDiagnosticReadRepository,
): Promise<UnitDiagnosticReadRecord | null> {
  return repository.findUnit({ userId, unitId });
}

export async function getDiagnostic(
  compatibilityClient: unknown,
  userId: string,
  unitId: string,
  diagnosticRead?: UnitDiagnosticReadRepository,
  presentationRead?: CognitiveModelPresentationReadRepository,
  stateRead?: LearnerStateProjectionReadRepository,
) {
  if (!diagnosticRead || !presentationRead) {
    throw new Error("Unit diagnostic persistence is not configured");
  }
  const unit = await readDiagnosticUnit(userId, unitId, diagnosticRead);
  if (!unit) throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  const learningTargets = await getUnitLearningTargetsV2(
    compatibilityClient as never,
    unitId,
    {
    userId,
      presentationRead,
      stateRead,
    },
  );
  const eligibility = evaluateUnitDiagnosticEligibility({
    goalKind: unit.goalKind,
    learningMode: unit.learningMode,
    unitKind: unit.unitKind,
    childCount: unit.childCount,
    unitStatus: unit.status,
  });
  return {
    eligible: eligibility.eligible,
    unitStatus: unit.status,
    completionMethod: unit.completionMethod,
    learningTargets: learningTargets.learningTargets,
    remediationUnitId: unit.remediationUnitId,
    latestAttempt: unit.latestAttempt
      ? {
          id: unit.latestAttempt.id,
          status: unit.latestAttempt.status,
          questions: parseJson<QuizQuestion[]>(
            unit.latestAttempt.questions,
            [],
          ),
          results: parseJson(unit.latestAttempt.results, []),
          perLearningTargetResults: parseJson(
            unit.latestAttempt.perLearningTargetResults,
            [],
          ),
          overallScore: unit.latestAttempt.overallScore,
          passed: unit.latestAttempt.passed,
          createdAt: unit.latestAttempt.createdAt.toISOString(),
          submittedAt: unit.latestAttempt.submittedAt?.toISOString() ?? null,
        }
      : null,
  };
}

export async function submitDiagnostic(
  compatibilityClient: unknown,
  userId: string,
  unitId: string,
  attemptId: string,
  answers: Record<string, string | number | boolean | number[]>,
  completionPersistence?: {
    userId: string;
    repository: UnitCompletionRepository;
    contextRead: UnitCompletionReadRepository;
    knowledgeRead?: CompletedUnitKnowledgeReadRepository;
    cognitiveModelEvent: CognitiveModelEventRepository;
  },
  generationRun?: CognitiveModelGenerationRunRepository,
  publication?: CognitiveModelPublicationRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  unitDiagnosticCompletion?: UnitDiagnosticCompletionRepository,
  projectBlueprint?: ProjectBlueprintRepository,
  diagnosticRead?: UnitDiagnosticReadRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  diagnosticRemediation?: DiagnosticRemediationRepository,
  presentationRead?: import("../../../../../domain/src/index.js").CognitiveModelPresentationReadRepository,
  assessmentTarget?: AssessmentTargetRepository,
) {
  if (
    !diagnosticRead ||
    !unitDiagnosticCompletion ||
    !diagnosticRemediation ||
    !assessmentTarget ||
    !presentationRead ||
    !completionPersistence
  ) {
    throw new Error("Unit diagnostic persistence is not configured");
  }
  const unit = await readDiagnosticUnit(userId, unitId, diagnosticRead);
  if (!unit) throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  const eligibility = evaluateUnitDiagnosticEligibility({
    goalKind: unit.goalKind,
    learningMode: unit.learningMode,
    unitKind: unit.unitKind,
    childCount: unit.childCount,
    unitStatus: unit.status,
  });
  if (
    !eligibility.eligible &&
    (eligibility.reason === "micro_goal" ||
      eligibility.reason === "exploration_goal")
  ) {
    throw new BadRequestException(
      tBackend("error.goal.explorationNoDiagnostic"),
    );
  }
  await assertUnitAssessmentReady(
    unitId,
    generationRun,
    publicationFinalization,
    learnerStateMemoryInvalidation,
    presentationRead,
  );
  if (!eligibility.eligible) {
    throw new BadRequestException(
      tBackend("error.learning.testOutUnavailable"),
    );
  }
  const attempt = await diagnosticRead.findAttempt({ userId, unitId, attemptId });
  if (!attempt)
    throw new NotFoundException(tBackend("error.learning.assessmentNotFound"));
  if (attempt.status === "submitted") {
    throw new BadRequestException(
      tBackend("error.learning.assessmentAlreadySubmitted"),
    );
  }
  const questions = parseJson<QuizQuestion[]>(attempt.questions, []);
  const targets: UnitAssessmentTarget[] = (
    await assessmentTarget.findForUnit({ userId, unitId })
  ).map((target) => ({
    ...target,
    assessmentCriteria: target.assessmentCriteria.map((criterion) => ({
      ...criterion,
    })),
    requirements: target.requirements.map((requirement) => ({
      ...requirement,
    })),
  }));
  if (!planUnitDiagnosticGeneration({ targets, priorAssessments: [] }).ready) {
    throw new BadRequestException(tBackend("error.learning.noTestOutTargets"));
  }
  const graded = await gradeQuiz(questions, answers);
  const submittedAt = new Date();
  const batch = buildUnitDiagnosticEvidenceBatch({
      goalId: unit.goalId,
      unitId,
      activityAttemptId: attempt.id,
      questions,
      results: graded.results,
      answers,
      targets,
      submittedAt,
    });
  const completion = await unitDiagnosticCompletion.complete({
      userId,
      goalId: unit.goalId,
      unitId,
      diagnosticAttemptId: attempt.id,
      entityIds: batch.entityIds,
      tasks: batch.tasks,
      completions: batch.completions,
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
        const criticalTargets = targets.filter(isCriticalLearningTarget);
        const cognitiveAssessments = await assessLearningTargetsFromState({
          targets: criticalTargets,
          stateFor,
        });
        const performance = scoreQuizByLearningTarget({
          questions,
          results: graded.results,
          targets,
        }).perLearningTarget;
        const decision = decideUnitDiagnosticSubmission({
          overallScore: graded.score,
          criticalTargets,
          performance,
          cognitiveAssessments,
        });
        return {
          answersJson: JSON.stringify(answers),
          resultsJson: JSON.stringify(graded.results),
          perLearningTargetResultsJson: JSON.stringify(
            decision.perLearningTarget,
          ),
          overallScore: decision.overallScore,
          passed: decision.passed,
          submittedAt,
        };
      },
    });
  const diagnostic: UnitDiagnosticDecision = {
    overallScore: completion.finalization.overallScore,
    passed: completion.finalization.passed,
    perLearningTarget: JSON.parse(
      completion.finalization.perLearningTargetResultsJson,
    ) as UnitDiagnosticTargetResult[],
  };
  await invalidateLearnerStateMemory(
    userId,
    "unit_diagnostic_completed",
    undefined,
    learnerStateMemoryInvalidation,
  );
  let nextUnitId: string | null = null;
  let remediationUnitId: string | null = null;
  if (diagnostic.passed) {
    await completeUnit(
      unitId,
      diagnostic.overallScore,
      true,
      {
        ...completionPersistence,
        completionMethod: "test_out",
        completionAttemptId: attempt.id,
      },
      learnerStateMemoryInvalidation,
    );
    await diagnosticRemediation.resolve({
      userId,
      sourceUnitId: unitId,
      completedAt: submittedAt,
    });
    await markAgendaItemCompletedForUnit(userId, unitId, "new_learning");
    const goalUnits = await diagnosticRead.listGoalUnits({
      userId,
      goalId: unit.goalId,
    });
    type GoalUnit = (typeof goalUnits)[number];
    const children = new Map<string | null, GoalUnit[]>();
    for (const goalUnit of goalUnits) {
      const siblings = children.get(goalUnit.parentUnitId) ?? [];
      siblings.push(goalUnit);
      children.set(goalUnit.parentUnitId, siblings);
    }
    for (const siblings of children.values()) {
      siblings.sort((a, b) => a.orderIndex - b.orderIndex);
    }
    const lessons: GoalUnit[] = [];
    const visit = (parentId: string | null) => {
      for (const goalUnit of children.get(parentId) ?? []) {
        if (goalUnit.unitKind === "lesson") lessons.push(goalUnit);
        visit(goalUnit.id);
      }
    };
    visit(null);
    const currentIndex = lessons.findIndex(
      (goalUnit) => goalUnit.id === unitId,
    );
    nextUnitId =
      lessons
        .slice(currentIndex + 1)
        .find((goalUnit) => !isUnitLearningDone(goalUnit.status))?.id ?? null;
  } else {
    const weakTargets = diagnostic.perLearningTarget.filter(
      (row) => !row.passed,
    );
    remediationUnitId = await diagnosticRemediation.upsert({
      userId,
      sourceUnitId: unitId,
      attemptId: attempt.id,
      weakTargets,
    });
  }
  await invalidateAgendaForUser(userId);
  return {
    attemptId: attempt.id,
    overallScore: diagnostic.overallScore,
    passed: diagnostic.passed,
    perLearningTargetResults: diagnostic.perLearningTarget,
    results: graded.results,
    weakTags: diagnostic.perLearningTarget
      .filter((row) => !row.passed)
      .map((row) => row.title),
    nextStep: diagnostic.passed ? "complete" : "weak_point_focus",
    unitStatus: diagnostic.passed ? "completed" : unit.status,
    completionMethod: diagnostic.passed ? "test_out" : null,
    nextUnitId,
    remediationUnitId,
  };
}
