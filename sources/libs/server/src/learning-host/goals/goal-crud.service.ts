import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  decodeMultipartFilename,
  getCurrentLocale,
  tBackend,
} from "../../../../common/src/index.js";
import type { LearningGoalSemanticPatch } from "../../../../domain/src/index.js";
import { parseSessionGraphState } from "../../graph/review-mode.js";
import {
  getContentLanguageLabel,
  isGoalContentLanguageSetting,
  resolveGoalContentLanguage,
} from "../../llm/content-language.js";
import {
  extractGoalCoursePattern,
  replaceGoalCoursePattern,
} from "../../llm/generation-options.js";
import {
  generateGoalCoursePattern,
  resolveGoalGenerationOptionsWithPattern,
} from "../../llm/goal-course-pattern.js";
import { FEATURE_COURSE_PATTERN } from "../../features.js";
import {
  deleteAllChunksByMetadata,
  deleteGoalCollection,
} from "../../rag/vector-store.js";
import { deleteLocalResource } from "../../rag/local-resource-store.js";
import { scheduleGoalIconGeneration } from "../../goals/ensure-goal-icon.js";
import {
  getLastLearnedUnitsByGoalIds,
  pickLastLearnedUnit,
  sortGoalsByLastStudied,
} from "../../goals/last-learned-unit.js";
import { aggregateLearningProgress } from "../../domain/learning-progress.js";
import {
  getTotalLearningSecondsByGoalIds,
  sumUnitLearningSeconds,
} from "../../persona/learning-time.js";
import { appendLearnerProfileToPromptOptions } from "../../persona/learner-profile.js";
import { ensureGoalTitleFromTopic } from "../../goals/refine-goal-title-from-topic.js";
import { resolveContinueLearningUnit } from "../../goals/continue-learning.js";
import { hasValidSqPreview } from "../../domain/sq-preview.js";
import { invalidateAgendaForUser } from "../../agenda/index.js";
import { invalidateLearnerStateMemory } from "../../learner-state-memory/index.js";
import {
  MasteryTransitionError,
  KacomDetachError,
  detachKacomForInternalTesting,
  requestGoalMasteryTransitionWithRepository,
} from "../../goals/learning-mode-transition.js";
import { isKacomDetachEnabled } from "../../features.js";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";
import { parseMapPlan } from "../../goals/map-plan.js";
import {
  parseFoundationGoalItems,
  summarizeFoundationProgress,
} from "../../goals/foundation-support.js";
import {
  computeCognitiveModelInputHash,
  getGoalCognitiveModel,
  getGoalMasterySummary,
} from "../../cognitive-model/index.js";
import { getAdaptiveAssessmentPlan } from "../../assessment/index.js";
import {
  serializeBranchUnit,
  serializeGoalOverviewUnit,
} from "./goal-serialize.util.js";

@Injectable()
export class GoalCrudService {
  constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) {}

  private async requireGoal(userId: string, goalId: string) {
    const goal = await this.learningSpaceOrm.learningGoal.findOwnedById(
      userId,
      goalId,
    );
    if (!goal) throw new NotFoundException(tBackend("error.goal.notFound"));
    return goal;
  }

  async listFoundationGoals(userId: string, goalId: string) {
    const parent = await this.requireGoal(userId, goalId);
    const plan = parseMapPlan(parent.mapPlanJson);
    const prerequisites = plan?.prerequisitesAssumed ?? [];
    const children =
      await this.learningSpaceOrm.goalCrudRead.listFoundationGoals(
        userId,
        goalId,
      );
    const foundationGoals = (
      children as Array<{
        id: string;
        title: string;
        status: string;
        mapPlanStatus: string;
        detailedPlanStatus: string;
        cognitiveModelStatus: string;
        learningMode: string;
        learningModeTransitionStatus: string;
        learningModeTransitionError: string;
        goalRelationContextJson: unknown;
        createdAt: Date;
        updatedAt: Date;
        units: Array<{ status: string }>;
        modules: Array<{ unlockStatus: string }>;
      }>
    ).map((child) => {
      const progress = summarizeFoundationProgress({
        unitStatuses: child.units.map((unit) => unit.status),
        moduleUnlockStatuses: child.modules.map(
          (module) => module.unlockStatus,
        ),
      });
      return {
        id: child.id,
        title: child.title,
        status: child.status,
        generationStatus:
          child.mapPlanStatus === "failed" ||
          child.detailedPlanStatus === "failed" ||
          (child.learningMode === "mastery" &&
            child.cognitiveModelStatus === "failed")
            ? "failed"
            : child.units.length > 0 || child.modules.length > 0
              ? "ready"
              : "preparing",
        prerequisiteItems: parseFoundationGoalItems(
          child.goalRelationContextJson,
        ),
        learningMode:
          child.learningMode === "exploration" ? "exploration" : "mastery",
        masteryTransition: {
          status: child.learningModeTransitionStatus,
          retryable: child.learningModeTransitionStatus === "failed",
          error: child.learningModeTransitionError || null,
        },
        ...progress,
        createdAt: child.createdAt.toISOString(),
        updatedAt: child.updatedAt.toISOString(),
      };
    });
    const covered = new Set(
      foundationGoals.flatMap((goal) => goal.prerequisiteItems),
    );
    return {
      prerequisites,
      uncoveredPrerequisites: prerequisites.filter(
        (item) => !covered.has(item),
      ),
      foundationGoals,
    };
  }

  async getMasterySummary(userId: string, goalId: string) {
    const goal = await this.requireGoal(userId, goalId);
    if (goal.learningMode === "exploration") {
      throw new ConflictException({
        code: "EXPLORATION_MODE",
        message: tBackend("error.goal.explorationNoMastery"),
      });
    }
    return getGoalMasterySummary(
      this.learningSpaceOrm.masterySummaryRead,
      userId,
      goalId,
    );
  }

  async upgradeFoundationToMastery(userId: string, goalId: string) {
    return this.enableGoalMastery(userId, goalId);
  }

  async enableGoalMastery(userId: string, goalId: string) {
    try {
      return await requestGoalMasteryTransitionWithRepository(
        userId,
        goalId,
        this.learningSpaceOrm.foundationMasteryTransition,
        this.learningSpaceOrm.cognitiveModelInvalidation,
      );
    } catch (error) {
      if (error instanceof MasteryTransitionError) {
        if (error.code === "not_found")
          throw new NotFoundException(tBackend("error.goal.notFound"));
        const message =
          error.code === "not_full_goal"
            ? tBackend("error.goal.notFullGoal")
            : error.code === "not_exploration"
              ? tBackend("error.goal.notExploration")
              : error.code === "curriculum_not_ready"
                ? tBackend("error.goal.curriculumNotReady")
                : error.code === "transition_conflict"
                  ? error.message
                  : tBackend("error.goal.shareActive");
        throw new ConflictException({
          code: error.code,
          message,
        });
      }
      throw error;
    }
  }

  async detachKacomForInternalTesting(goalId: string) {
    if (!isKacomDetachEnabled(process.env.NODE_ENV !== "production")) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    try {
      return await detachKacomForInternalTesting(
        goalId,
        this.learningSpaceOrm.foundationMasteryTransition,
        this.learningSpaceOrm.learnerStateMemoryInvalidation,
      );
    } catch (error) {
      if (error instanceof KacomDetachError) {
        if (error.code === "not_found") {
          throw new NotFoundException(tBackend("error.goal.notFound"));
        }
        const message =
          error.code === "share_active"
            ? tBackend("error.goal.shareActive")
            : tBackend("error.goal.notKacomGoal");
        throw new ConflictException({
          code: error.code,
          message,
        });
      }
      throw error;
    }
  }

  async getAdaptiveAssessment(userId: string, goalId: string) {
    const goal = await this.requireGoal(userId, goalId);
    if (goal.learningMode === "exploration") {
      throw new ConflictException({
        code: "EXPLORATION_MODE",
        message: tBackend("error.goal.explorationNoDiagnostic"),
      });
    }
    return getAdaptiveAssessmentPlan(
      undefined,
      userId,
      "goal",
      { goalId },
      {
        targetRepository: this.learningSpaceOrm.assessmentTarget,
        evidenceRepository: this.learningSpaceOrm.adaptiveAssessmentEvidence,
        taskRepository: this.learningSpaceOrm.adaptiveAssessmentTask,
      },
    );
  }

  async listGoals(userId: string) {
    const overview =
      await this.learningSpaceOrm.goalCrudRead.listOwnedOverview(userId);
    const { goals, units, modules, pendingShares } = overview;
    const goalIds = goals.map((g) => g.id);
    const [lastLearnedByGoal, learningSecondsByGoal] = await Promise.all([
      getLastLearnedUnitsByGoalIds(goalIds, this.learningSpaceOrm.learningGoal),
      getTotalLearningSecondsByGoalIds(
        goalIds,
        this.learningSpaceOrm.learningGoal,
      ),
    ]);

    const pendingShareIdByGoal = new Map<string, string>();
    for (const share of pendingShares) {
      if (!pendingShareIdByGoal.has(share.goalId)) {
        pendingShareIdByGoal.set(share.goalId, share.id);
      }
    }
    const unitsByGoalId = new Map<string, typeof units>();
    for (const unit of units) {
      const list = unitsByGoalId.get(unit.goalId) ?? [];
      list.push(unit);
      unitsByGoalId.set(unit.goalId, list);
    }
    const modulesByGoalId = new Map<string, typeof modules>();
    for (const module of modules) {
      const list = modulesByGoalId.get(module.goalId) ?? [];
      list.push(module);
      modulesByGoalId.set(module.goalId, list);
    }

    const mapped = goals.map((g) => {
      const allGoalUnits = unitsByGoalId.get(g.id) ?? [];
      const goalUnits =
        g.curriculumVersion === 2
          ? allGoalUnits.filter(
              (unit) =>
                !unit.moduleId || unit.module?.unlockStatus !== "locked",
            )
          : allGoalUnits;
      const goalModules = modulesByGoalId.get(g.id) ?? [];
      const learningProgress = aggregateLearningProgress(goalUnits);
      const completedModuleCount = goalModules.filter(
        (module) => module.unlockStatus === "completed",
      ).length;
      const moduleProgressPercent =
        goalModules.length > 0
          ? Math.round((completedModuleCount / goalModules.length) * 100)
          : learningProgress.progressPercent;
      const currentModule =
        goalModules.find(
          (module) =>
            module.unlockStatus === "unlocked" &&
            module.generationStatus !== "ready",
        ) ??
        goalModules.find((module) => module.unlockStatus === "unlocked") ??
        null;
      const totalLearningSeconds = learningSecondsByGoal.get(g.id) ?? 0;
      const lastLearnedUnit = lastLearnedByGoal.get(g.id) ?? null;
      return {
        id: g.id,
        title: g.title,
        level: g.level,
        goalKind: g.goalKind === "micro" ? "micro" : "full",
        learningMode:
          g.learningMode === "exploration" ? "exploration" : "mastery",
        curriculumVersion: g.curriculumVersion,
        pathSource: g.pathSource,
        contentLanguage: g.contentLanguage,
        teachingPersonaRef: g.teachingPersonaRef,
        status: g.status,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
        unitCount: learningProgress.totalUnits,
        completedCount: learningProgress.completedUnits,
        progressPercent:
          g.curriculumVersion === 2
            ? moduleProgressPercent
            : learningProgress.progressPercent,
        progressUnits: learningProgress.progressUnits,
        completedModuleCount,
        totalModuleCount: goalModules.length,
        currentModuleId: currentModule?.id ?? null,
        totalLearningSeconds,
        documentCount: g._count.documents,
        iconSvg: g.iconSvg,
        iconTint: g.iconTint,
        shareVisibility: "off",
        activeShareId: g.activeShareId,
        pendingShareId: pendingShareIdByGoal.get(g.id) ?? null,
        lastLearnedUnit,
        nextLearningUnit: resolveContinueLearningUnit(
          goalUnits,
          lastLearnedUnit?.id,
        ),
      };
    });

    return { goals: sortGoalsByLastStudied(mapped) };
  }

  async ensureGoalIcon(userId: string, goalId: string) {
    const { ensureGoalIcon } =
      await import("../../goals/ensure-goal-icon.js");
    const updated = await ensureGoalIcon(
      userId,
      goalId,
      undefined,
      this.learningSpaceOrm.goalIcon,
    );
    if (!updated) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    return {
      iconSvg: updated.iconSvg,
      iconTint: updated.iconTint,
    };
  }

  async createGoal(
    userId: string,
    body: {
      title: string;
      level?: string;
      generationOptions?: string;
    },
  ) {
    const { title: rawTitle, level = "zero", generationOptions } = body;
    const contentLanguage = resolveGoalContentLanguage(
      "auto",
      rawTitle,
      getCurrentLocale(),
    );
    const { refinedTitle } = await ensureGoalTitleFromTopic(
      rawTitle,
      undefined,
      { userId, contentLanguage },
    );
    const title = refinedTitle || rawTitle;
    const resolvedGenerationOptions =
      await resolveGoalGenerationOptionsWithPattern({
        title,
        level,
        contentLanguage,
        generationOptions,
      });
    const learnerGenerationOptions = await appendLearnerProfileToPromptOptions(
      userId,
      resolvedGenerationOptions,
      this.learningSpaceOrm.learnerStateMemoryRead,
    );

    const goal = await this.learningSpaceOrm.service.createOwnedGoal(userId, {
      title,
      level,
      contentLanguage,
      generationOptions: learnerGenerationOptions,
      curriculumVersion: 2,
    });

    scheduleGoalIconGeneration(userId, goal.id, title);

    await invalidateAgendaForUser(userId);

    return { goalId: goal.id };
  }

  async deleteGoal(userId: string, goalId: string) {
    const goalTreeDeletion = this.learningSpaceOrm.goalTreeDeletion;
    const deletion = await goalTreeDeletion.deleteOwnedGoalTree({
      userId,
      goalId,
    });
    const goalIdsToDelete = deletion.deletedGoalIds;
    if (goalIdsToDelete.length === 0) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    await invalidateAgendaForUser(userId);
    await invalidateLearnerStateMemory(
      userId,
      "goal_deleted",
      undefined,
      this.learningSpaceOrm.learnerStateMemoryInvalidation,
    );
    for (const deleteGoalId of goalIdsToDelete) {
      await deleteGoalCollection(deleteGoalId);
      try {
        await deleteAllChunksByMetadata("web_knowledge", userId, {
          goalId: deleteGoalId,
        });
      } catch (error) {
        console.warn(
          "[web-knowledge] immediate goal vector cleanup failed; queued for retry:",
          error instanceof Error ? error.message : error,
        );
      }
    }
    for (const storageKey of deletion.deletedResourceStorageKeys) {
      if (
        (await this.learningSpaceOrm.ragDocument.countByStorageKey(
          storageKey,
        )) === 0
      ) {
        await deleteLocalResource(storageKey);
      }
    }

    return { ok: true };
  }

  async getGoal(
    userId: string,
    goalId: string,
    view: "full" | "compact" = "compact",
  ) {
    await this.requireGoal(userId, goalId);

    const compact = view === "compact";

    const goal = await this.learningSpaceOrm.goalCrudRead.findDetail(
      userId,
      goalId,
    );
    if (!goal) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }

    const creationSession = goal.creationSession;

    const overviewUnits = goal.units.filter(
      (u: any) => u.unitKind === "overview",
    );
    const mapUnits = goal.units.filter(
      (unit: any) =>
        unit.unitKind !== "overview" &&
        (goal.curriculumVersion !== 2 ||
          !unit.moduleId ||
          unit.module?.unlockStatus !== "locked"),
    );

    const units = mapUnits.map((u: any) => {
      const hasMaterial = Boolean(u.learningMaterial);
      const session = u.sessionState as {
        currentStep?: string | null;
        sq3rData?: string;
        graphState?: string;
        cumulativeActiveSeconds?: number;
        updatedAt?: Date;
      } | null;
      const hasSq = hasValidSqPreview(session?.sq3rData);
      return {
        ...serializeBranchUnit(u),
        contentRevision: u.contentRevision ?? 0,
        nextReviewAt: u.reviewCard?.nextReviewAt?.toISOString() ?? null,
        reviewIntervalDays: u.reviewCard?.intervalDays ?? null,
        sessionState: compact
          ? session
            ? {
                currentStep: session.currentStep ?? null,
                updatedAt: session.updatedAt,
              }
            : null
          : session,
        learningMaterial: compact
          ? hasMaterial
            ? { hasContent: true as const }
            : null
          : u.learningMaterial,
        contentStatus: {
          hasMaterial,
          hasSq,
        },
      };
    });

    const serializedOverviewUnits = overviewUnits.map((u: any) =>
      serializeGoalOverviewUnit({
        id: u.id,
        title: u.title,
        contentSummary: u.contentSummary,
        note: u.note,
        orderIndex: u.orderIndex,
        status: u.status,
        learningMaterial: compact
          ? null
          : (u.learningMaterial as {
              introduction: string;
              sections: string;
              keyTakeaways: string;
            } | null),
      }),
    );

    return {
      goal: {
        id: goal.id,
        title: goal.title,
        status: goal.status,
        goalKind: goal.goalKind === "micro" ? "micro" : "full",
        learningMode:
          goal.learningMode === "exploration" ? "exploration" : "mastery",
        masteryTransition: {
          status: goal.learningModeTransitionStatus,
          retryable: goal.learningModeTransitionStatus === "failed",
          error: goal.learningModeTransitionError || null,
        },
        curriculumVersion: goal.curriculumVersion,
        pathSource: goal.pathSource,
        topicOverview: goal.topicOverview,
        overviewCourseStatus: goal.overviewCourseStatus,
        creationSession: creationSession
          ? {
              ...creationSession,
              updatedAt: creationSession.updatedAt.toISOString(),
            }
          : null,
        generationOptions: goal.generationOptions,
        shareVisibility: "off",
        activeShareId: goal.activeShareId,
        pendingShareId: null,
        uploadedDocuments: goal.documents.map((document: any) => ({
          id: document.id,
          filename: decodeMultipartFilename(document.filename),
          createdAt: document.createdAt.toISOString(),
          sourceType: document.sourceType,
          sourceUrl: document.sourceUrl,
          canonicalUrl: document.canonicalUrl,
          provider: document.provider,
          title: document.title,
          warning: document.warning,
          subtitleStatus: document.subtitleStatus,
          hasOriginal: Boolean(document.storageKey),
          contentType: document.contentType,
          byteSize:
            document.byteSize == null ? null : Number(document.byteSize),
          storageKey: document.storageKey,
        })),
        overviewCourse:
          serializedOverviewUnits.length > 0
            ? {
                title:
                  serializedOverviewUnits[0]?.title ?? `${goal.title} overview`,
                summary: goal.topicOverview,
                units: serializedOverviewUnits,
              }
            : null,
        units,
        totalLearningSeconds: sumUnitLearningSeconds(
          goal.units,
          parseSessionGraphState,
        ),
        lastLearnedUnit: pickLastLearnedUnit(goal.units),
        foundationGoals:
          goal.goalKind === "micro"
            ? []
            : (await this.listFoundationGoals(userId, goalId)).foundationGoals,
        parentGoal:
          goal.parentGoalId && goal.goalRelationType === "foundation_support"
            ? goal.parentGoal
            : null,
      },
    };
  }

  async getCognitiveModel(
    userId: string,
    goalId: string,
    view: "atoms" | "constructs" | "full" = "full",
  ) {
    const ownedGoal = await this.requireGoal(userId, goalId);
    const goal = await this.learningSpaceOrm.goalCrudRead.findCognitiveStatus(
      userId,
      goalId,
    );
    if (!goal) throw new NotFoundException(tBackend("error.goal.notFound"));
    if (goal.learningMode === "exploration") {
      throw new ConflictException({
        code: "EXPLORATION_MODE",
        message: tBackend("error.goal.explorationNoModel"),
      });
    }
    if (goal.curriculumVersion === 2 && goal.modules.length > 0) {
      throw new ConflictException({
        code: "MODULE_GENERATING",
        message: tBackend("error.goal.cognitiveModelBuilding"),
      });
    }
    if (
      goal.cognitiveModelStatus === "pending" ||
      goal.cognitiveModelVersion === 0
    ) {
      const units =
        await this.learningSpaceOrm.learningUnit.listForCurriculum(goalId);
      await this.learningSpaceOrm.cognitiveModelPublication.ensureSkeleton({
        goalId,
        inputHash: computeCognitiveModelInputHash(ownedGoal, units),
      });
    }
    const graph = await getGoalCognitiveModel(undefined, goalId, {
      userId,
      view,
      presentationRead: this.learningSpaceOrm.cognitiveModelPresentationRead,
      stateRead: this.learningSpaceOrm.learnerStateProjectionRead,
    });
    if (!graph) throw new NotFoundException(tBackend("error.goal.notFound"));
    return graph;
  }

  async patchGoalSettings(
    userId: string,
    goalId: string,
    body: { title?: string; contentLanguage?: string; coursePattern?: string },
  ) {
    const existing = await this.requireGoal(userId, goalId);
    if (
      body.title === undefined &&
      body.contentLanguage === undefined &&
      body.coursePattern === undefined
    ) {
      throw new BadRequestException(tBackend("error.goal.settingsRequired"));
    }

    const data: {
      title?: string;
      contentLanguage?: string;
      generationOptions?: string;
    } = {};

    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) {
        throw new BadRequestException(tBackend("error.goal.titleRequired"));
      }
      data.title = title;
    }

    if (body.contentLanguage !== undefined) {
      if (!isGoalContentLanguageSetting(body.contentLanguage)) {
        throw new BadRequestException(
          tBackend("error.goal.invalidContentLanguage"),
        );
      }
      data.contentLanguage =
        body.contentLanguage === "auto"
          ? resolveGoalContentLanguage("auto", "", getCurrentLocale())
          : body.contentLanguage;
    }

    if (body.coursePattern !== undefined) {
      if (!FEATURE_COURSE_PATTERN) {
        throw new BadRequestException(
          tBackend("error.goal.courseModeDisabled"),
        );
      }
      data.generationOptions = replaceGoalCoursePattern(
        existing.generationOptions,
        body.coursePattern,
      );
    }

    if (data.title !== undefined || data.contentLanguage !== undefined) {
      const semanticPatch: LearningGoalSemanticPatch =
        data.title !== undefined
          ? {
              title: data.title,
              ...(data.contentLanguage !== undefined
                ? { contentLanguage: data.contentLanguage }
                : {}),
              ...(body.coursePattern !== undefined
                ? { generationOptions: data.generationOptions! }
                : {}),
            }
          : {
              contentLanguage: data.contentLanguage!,
              ...(body.coursePattern !== undefined
                ? { generationOptions: data.generationOptions! }
                : {}),
            };
      const updated =
        await this.learningSpaceOrm.goalMutations.updateOwnedSemantic({
          userId,
          goalId,
          patch: semanticPatch,
        });
      if (!updated) {
        throw new NotFoundException(tBackend("error.goal.notFound"));
      }
      const resolvedLanguage = resolveGoalContentLanguage(
        updated.contentLanguage,
        updated.title,
        getCurrentLocale(),
      );
      await invalidateAgendaForUser(userId);
      return {
        ok: true,
        title: updated.title,
        contentLanguage: updated.contentLanguage,
        contentLanguageLabel: getContentLanguageLabel(resolvedLanguage),
        coursePattern: extractGoalCoursePattern(updated.generationOptions),
      };
    }

    const goalSettings = this.learningSpaceOrm.learningGoalSettings;
    const goal = await goalSettings.updateOwned({
      userId,
      goalId,
      patch: data,
    });
    if (!goal) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }

    const resolvedLanguage = resolveGoalContentLanguage(
      goal.contentLanguage,
      goal.title,
      getCurrentLocale(),
    );

    if (data.title !== undefined || data.contentLanguage !== undefined) {
      await this.learningSpaceOrm.cognitiveModelInvalidation.invalidate({
        goalId,
        reason: "course_identity_updated",
      });
      await invalidateAgendaForUser(userId);
    }

    return {
      ok: true,
      title: goal.title,
      contentLanguage: goal.contentLanguage,
      contentLanguageLabel: getContentLanguageLabel(resolvedLanguage),
      coursePattern: extractGoalCoursePattern(goal.generationOptions),
    };
  }

  async regenerateGoalCoursePattern(userId: string, goalId: string) {
    if (!FEATURE_COURSE_PATTERN) {
      throw new BadRequestException(tBackend("error.goal.courseModeDisabled"));
    }
    const goal = await this.requireGoal(userId, goalId);
    const contentLanguage = resolveGoalContentLanguage(
      goal.contentLanguage,
      goal.title,
    );
    const generationOptionsWithProfile =
      await appendLearnerProfileToPromptOptions(
        userId,
        goal.generationOptions,
        this.learningSpaceOrm.learnerStateMemoryRead,
      );
    const pattern = await generateGoalCoursePattern({
      title: goal.title,
      level: goal.level,
      contentLanguage,
      generationOptions: generationOptionsWithProfile,
    });
    const generationOptions = replaceGoalCoursePattern(
      generationOptionsWithProfile,
      pattern,
    );
    const goalSettings = this.learningSpaceOrm.learningGoalSettings;
    const updated = await goalSettings.updateOwned({
      userId,
      goalId,
      patch: { generationOptions },
    });
    if (!updated) {
      throw new NotFoundException(tBackend("error.goal.notFound"));
    }
    return { ok: true, coursePattern: pattern };
  }
}
