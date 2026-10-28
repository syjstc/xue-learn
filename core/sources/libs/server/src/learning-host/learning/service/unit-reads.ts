import { HttpException, HttpStatus, NotFoundException } from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import {
  isUnitLearningDone,
  type UnitActivityRepository,
  type CognitiveModelGenerationRunRepository,
  type CognitiveModelEventRepository,
  type CognitiveModelPublicationFinalizationRepository,
  type LearnerStateMemoryInvalidationRepository,
  type UnitDeliveryReadRepository,
} from "../../../../../domain/src/index.js";
import {
  canSubdivideAtDepth,
  isModuleUnit,
} from "../../../domain/unit-tree.js";
import { isMicroGoal } from "../../../domain/goal-kind.js";
import { FEATURE_SUBDIVIDE_UNIT } from "../../../features.js";
import {
  parseLearningMaterial,
  parseMaterialContextSources,
} from "../../../graph/unit-session.js";
import { parseSessionGraphState } from "../../../graph/review-mode.js";
import { applyCanonicalLearningTargetsToSq } from "../../../graph/canonical-sq.js";
import { getUnitLearningTargetsV2 } from "../../../cognitive-model/index.js";
import {
  listMaterialCheckResults,
  publishedMaterialCheckDefinitions,
} from "../../../assessment/index.js";
import {
  resolveGoalContentLanguage,
} from "../../../llm/content-language.js";
import { socraticSessionPayload } from "../../../graph/socratic-threads.js";
import { parseJson } from "../../../utils.js";
import {
  getAggregatedUnitMaterial,
  getUnitSectionManifest,
} from "../../../sections/index.js";
import {
  projectUnitSessionProgress,
  resolveUnitPageCurrentStep,
  unitContentRevisionMatches,
} from "../../../unit-session/application.js";

import { migrateLegacyReviewMode, parseSqData } from "./helpers/session-graph.js";
import { buildActiveQuizResponse, loadQuizExplanations } from "./helpers/quiz.js";
import { getUnitLearningAccess } from "./helpers/assessment-gate.js";
import { parseScenarioTheaterDefinition } from "../../../scenario-theater/schema.js";
import { parseUnitLabDefinition } from "../../../unit-lab/schema.js";
import { resolveTeachingPersona } from "../../../teaching-personas/index.js";

async function labContent(repository: UnitDeliveryReadRepository, userId: string, unitId: string) {
  const lab = await repository.findLabContent({ userId, unitId });
  if (!lab) return null;
  const definition =
    ["prepared", "ready"].includes(lab.status) && lab.definitionJson
      ? parseUnitLabDefinition(lab.definitionJson)
      : null;
  return {
    status: lab.status,
    recommended: lab.recommended,
    recommendation: lab.recommendation,
    revision: lab.revision,
    definition,
    generationError: lab.status === "failed" ? lab.generationError : "",
  };
}

async function labSession(repository: UnitDeliveryReadRepository, userId: string, unitId: string) {
  const lab = await repository.findLabSession({ userId, unitId });
  if (!lab) return { available: false, completedOnce: false, openedOnce: false };
  return {
    available: ["prepared", "ready"].includes(lab.status),
    status: lab.status,
    revision: lab.revision,
    completedOnce: lab.completedOnce,
    openedOnce: lab.openedOnce,
  };
}

async function scenarioContent(repository: UnitDeliveryReadRepository, userId: string, unitId: string) {
  const theater = await repository.findScenarioContent({ userId, unitId });
  if (!theater) return null;
  let definition = null;
  if (["prepared", "ready"].includes(theater.status) && theater.definitionJson) {
    const parsed = parseScenarioTheaterDefinition(theater.definitionJson);
    const coach = await resolveTeachingPersona(userId, theater.goalId);
    definition = { ...parsed, coach: { name: coach.name, avatarCode: coach.avatarCode } };
  }
  return { status: theater.status, recommended: theater.recommended, recommendation: theater.recommendation, revision: theater.revision, definition, generationError: theater.status === "failed" ? theater.generationError : "" };
}

async function scenarioSession(repository: UnitDeliveryReadRepository, userId: string, unitId: string) {
  const theater = await repository.findScenarioSession({ userId, unitId });
  if (!theater) return { available: false, completedOnce: false, activeRun: null };
  const run = theater.activeRun;
  return { available: ["prepared", "ready"].includes(theater.status), status: theater.status, revision: theater.revision, completedOnce: theater.completedOnce,
    activeRun: run ? { id: run.id, theaterRevision: run.theaterRevision, runVersion: run.runVersion, status: run.status, currentSceneId: run.currentSceneId,
      meters: run.metersJson && typeof run.metersJson === "object" ? run.metersJson : parseJson(String(run.metersJson ?? "{}"), {}),
      path: Array.isArray(run.pathJson) ? run.pathJson : parseJson(String(run.pathJson ?? "[]"), []), endingId: run.endingId,
      startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null } : null,
    currentSceneStatus: theater.currentSceneStatus };
}

export async function getUnitPage(
  repository: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  goalId?: string,
) {
  const unit = await repository.findPage({ userId, unitId });
  if (!unit) {
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  }
  if (goalId && unit.goalId !== goalId) {
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  }

  const goal = { goalKind: unit.goalKind, learningMode: unit.learningMode };
  const isModule = isModuleUnit(unit) && unit.childCount > 0;
  const canForceSubdivide =
    FEATURE_SUBDIVIDE_UNIT &&
    !isMicroGoal(goal) &&
    unit.childCount === 0 &&
    canSubdivideAtDepth(unit.depth);
  const sections = isMicroGoal(goal)
    ? []
    : await getUnitSectionManifest(userId, unitId, undefined);
  const pageCurrentStep = resolveUnitPageCurrentStep({
    unitStatus: unit.status,
    persistedCurrentStep: unit.currentStep,
  });

  return {
    unit: {
      id: unit.id,
      title: unit.title,
      goalId: unit.goalId,
      parentUnitId: unit.parentUnitId,
      contentSummary: unit.contentSummary,
      unitKind: unit.unitKind,
      status: unit.status,
      completionMethod: unit.completionMethod,
      sessionState: unit.currentStep
        ? { currentStep: pageCurrentStep }
        : null,
      learningSteps: Array.isArray(unit.decompositionSteps)
        ? unit.decompositionSteps
        : [],
      sections,
    },
    goal: {
      id: unit.goalId,
      title: unit.goalTitle,
      goalKind: unit.goalKind === "micro" ? "micro" : "full",
      learningMode:
        unit.learningMode === "exploration" ? "exploration" : "mastery",
      domainTag: unit.domainTag,
    },
    isModule,
    canForceSubdivide,
  };
}

export async function getUnitContent(
  repository: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  revision?: number,
  presentationRead?: import("../../../../../domain/src/index.js").CognitiveModelPresentationReadRepository,
  stateRead?: import("../../../../../domain/src/index.js").LearnerStateProjectionReadRepository,
) {
  const unit = await repository.findContent({ userId, unitId });
  if (!unit) {
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  }

  const contentRevision = unit.contentRevision ?? 0;
  if (
    !unitContentRevisionMatches({
      requestedRevision: revision,
      contentRevision,
    })
  ) {
    throw new HttpException(
      {
        message: tBackend("error.learning.contentRevisionMismatch"),
        contentRevision,
      },
      HttpStatus.CONFLICT,
    );
  }

  const storedSq = unit.sq3rData ? parseSqData(unit.sq3rData) : null;
  const { learningTargets: canonicalLearningTargets } =
    await getUnitLearningTargetsV2(undefined, unitId, {
      userId,
      presentationRead,
      stateRead,
    });
  const sq = storedSq
    ? applyCanonicalLearningTargetsToSq(storedSq, canonicalLearningTargets)
    : null;
  const sections = await getUnitSectionManifest(userId, unitId, undefined);
  const material = sections.some((section) => !section.legacy)
    ? await getAggregatedUnitMaterial(unitId, undefined)
    : unit.learningMaterial
      ? parseLearningMaterial(unit.learningMaterial)
      : null;
  const materialSources = unit.learningMaterial
    ? parseMaterialContextSources(unit.learningMaterial)
    : [];
  const graphState = unit.graphState ? parseSessionGraphState(unit.graphState) : {};

  return {
    unitId,
    contentRevision,
    sq,
    material,
    materialSources,
    learningSteps: Array.isArray(unit.decompositionSteps)
      ? unit.decompositionSteps
      : [],
    sections,
    scenarioTheaterContent: await scenarioContent(repository, userId, unitId),
    unitLabContent: await labContent(repository, userId, unitId),
  };
}

export async function getLearningAccess(
  repository: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  generationRun?: CognitiveModelGenerationRunRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  cognitiveModelEvent?: CognitiveModelEventRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  presentationRead?: import("../../../../../domain/src/index.js").CognitiveModelPresentationReadRepository,
) {
  const unit = await repository.findLearningAccess({ userId, unitId });
  if (!unit) throw new NotFoundException(tBackend("error.goal.unitNotFound"));

  const modelRecovery =
    unit.goalKind !== "micro" &&
    unit.learningMode !== "exploration" &&
    unit.cognitiveModelStatus === "failed"
      ? cognitiveModelEvent
        ? await cognitiveModelEvent.recoverFailedUnit({
            goalId: unit.goalId,
            unitId: unit.id,
          })
        : (() => { throw new Error("Cognitive-model event persistence is unavailable"); })()
      : null;
  return getUnitLearningAccess(
    {
      id: unit.id,
      goalId: unit.goalId,
      userId,
      cognitiveModelStatus: modelRecovery?.triggered
        ? "pending"
        : unit.cognitiveModelStatus,
      cognitiveModelBuildInputHash: modelRecovery?.triggered
        ? null
        : unit.cognitiveModelBuildInputHash,
      goal: modelRecovery?.triggered
        ? {
            goalKind: unit.goalKind,
            learningMode: unit.learningMode,
            cognitiveModelStatus: modelRecovery.goalStatus,
            cognitiveModelInputHash: unit.goalCognitiveModelInputHash,
            cognitiveModelPublishedHash: unit.goalCognitiveModelPublishedHash,
          }
        : {
            goalKind: unit.goalKind,
            learningMode: unit.learningMode,
            cognitiveModelStatus: unit.goalCognitiveModelStatus,
            cognitiveModelInputHash: unit.goalCognitiveModelInputHash,
            cognitiveModelPublishedHash: unit.goalCognitiveModelPublishedHash,
          },
      canonicalTargetCount: unit.canonicalTargetCount,
      module: {
        unlockStatus: unit.moduleUnlockStatus,
        generationStatus: unit.moduleGenerationStatus,
      },
      hasCanonicalContent: unit.hasCanonicalContent,
    },
    generationRun,
    publicationFinalization,
    learnerStateMemoryInvalidation,
    presentationRead,
  );
}

export async function getSession(
  repository: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  activityRepository: UnitActivityRepository,
  generationRun?: CognitiveModelGenerationRunRepository,
  publicationFinalization?: CognitiveModelPublicationFinalizationRepository,
  cognitiveModelEvent?: CognitiveModelEventRepository,
  learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  presentationRead?: import("../../../../../domain/src/index.js").CognitiveModelPresentationReadRepository,
  unitSessionState?: import("../../../../../domain/src/index.js").UnitSessionStateRepository,
  quizSession?: import("../../../../../domain/src/index.js").QuizSessionRepository,
) {
  if (!unitSessionState || !quizSession) {
    throw new Error("Unit session persistence is not configured");
  }
  const unit = await repository.findSession({ userId, unitId });
  if (!unit) {
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  }

  const session = unit.session;
  const sections = await getUnitSectionManifest(userId, unitId, undefined);
  const material = sections.some((section) => !section.legacy)
    ? await getAggregatedUnitMaterial(unitId, undefined)
    : unit.learningMaterial
      ? parseLearningMaterial(unit.learningMaterial)
      : null;
  const materialCheckDefinitions = material
    ? publishedMaterialCheckDefinitions(material)
    : [];
  const materialCheckResults = await listMaterialCheckResults({
    userId,
    unitId,
    checkIds: materialCheckDefinitions.map((definition) => definition.checkId),
    attempts: await repository.listMaterialCheckAttempts({
      userId,
      unitId,
      stableKeyPrefixes: materialCheckDefinitions.map((definition) =>
        `assessment:material-check:${definition.checkId}`,
      ),
    }),
  });
  const graphState = session
    ? await migrateLegacyReviewMode(
        unitSessionState,
        userId,
        unitId,
        session.graphState,
      )
    : {};
  const quizSets = await quizSession.listQuizSets({ userId, unitId });
  const activeQuiz = buildActiveQuizResponse(graphState);
  if (activeQuiz?.quizAttemptId) {
    activeQuiz.quizExplanations = await loadQuizExplanations(
      quizSession,
      userId,
      unitId,
      activeQuiz.quizAttemptId,
    );
  }

  let currentStep = session?.currentStep ?? "structured_input";

  const contentLanguage = resolveGoalContentLanguage(
    unit.contentLanguage,
    unit.goalTitle,
  );
  const modelRecovery =
    unit.access.goalKind !== "micro" &&
    unit.access.learningMode !== "exploration" &&
    unit.access.cognitiveModelStatus === "failed"
      ? cognitiveModelEvent
        ? await cognitiveModelEvent.recoverFailedUnit({
            goalId: unit.access.goalId,
            unitId: unit.access.id,
          })
        : (() => { throw new Error("Cognitive-model event persistence is unavailable"); })()
      : null;
  const learningAccess = await getUnitLearningAccess(
    {
      id: unit.access.id,
      goalId: unit.access.goalId,
      userId,
      cognitiveModelStatus: modelRecovery?.triggered
        ? "pending"
        : unit.access.cognitiveModelStatus,
      cognitiveModelBuildInputHash: modelRecovery?.triggered
        ? null
        : unit.access.cognitiveModelBuildInputHash,
      goal: modelRecovery?.triggered
        ? {
            goalKind: unit.access.goalKind,
            learningMode: unit.access.learningMode,
            cognitiveModelStatus: modelRecovery.goalStatus,
            cognitiveModelInputHash: unit.access.goalCognitiveModelInputHash,
            cognitiveModelPublishedHash: unit.access.goalCognitiveModelPublishedHash,
          }
        : {
            goalKind: unit.access.goalKind,
            learningMode: unit.access.learningMode,
            cognitiveModelStatus: unit.access.goalCognitiveModelStatus,
            cognitiveModelInputHash: unit.access.goalCognitiveModelInputHash,
            cognitiveModelPublishedHash: unit.access.goalCognitiveModelPublishedHash,
          },
      canonicalTargetCount: unit.access.canonicalTargetCount,
      module: { unlockStatus: unit.access.moduleUnlockStatus, generationStatus: unit.access.moduleGenerationStatus },
      hasCanonicalContent: unit.access.hasCanonicalContent,
    },
    generationRun,
    publicationFinalization,
    learnerStateMemoryInvalidation,
    presentationRead,
  );

  const sessionProgress = projectUnitSessionProgress({
    currentStep,
    structuredSubStep: session?.structuredSubStep ?? "sq",
    unitStatus: unit.status,
    isLearningDone: isUnitLearningDone(unit.status),
    contentRevision: unit.contentRevision ?? 0,
    sections,
  });

  const response = {
    unitId,
    learningAccess,
    ...sessionProgress,
    teachingPersonaRef: unit.teachingPersonaRef,
    contentLanguage,
    ...socraticSessionPayload(
      graphState.socraticThreads ?? [],
      graphState.activeSocraticThreadId ?? "",
    ),
    // Static generated bodies live on GET /content; session stays dynamic.
    materialPresentation: graphState.materialPresentation ?? null,
    sq: null,
    material: null,
    materialSources: [],
    pathSource: unit.pathSource,
    cornell: unit.cornellNote
      ? {
          notes: unit.cornellNote.notes,
          cues: unit.cornellNote.cues,
          summary: unit.cornellNote.summary,
        }
      : null,
    quizSets,
    activeQuiz,
    materialCheckResults,
    sqQuestionAnswers: graphState.sqQuestionAnswers ?? null,
    scenarioTheater: await scenarioSession(repository, userId, unitId),
    unitLab: await labSession(repository, userId, unitId),
  };

  void activityRepository
    .touchOwned({
      userId,
      unitId,
      tab: session?.structuredSubStep ?? "sq",
    })
    .catch(() => undefined);

  return response;
}
