import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  Optional,
} from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import type { LearnerStateMemoryInvalidationRepository } from "../../../../domain/src/index.js";
import {
  CognitionPersistenceError,
  parseLearnerProjectAttemptSubmission,
  parseProjectObservationSubmission,
  ProjectValidationError,
  validateProjectAttemptPayload,
  type AdminTestProjectMode,
} from "../../cognition/index.js";
import { invalidateLearnerStateMemory } from "../../learner-state-memory/index.js";
import { LEARNER_STATE_MEMORY_INVALIDATION_REPOSITORY } from "../../learning-spaces/learner-state-memory-read-token.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";

function rethrowProjectError(error: unknown): never {
  const messageFor = (code: string) =>
    code === "not_found"
      ? tBackend("error.project.notFound")
      : code === "ownership_mismatch"
        ? tBackend("error.project.forbidden")
        : code === "idempotency_conflict" ||
            code === "immutable_declaration" ||
            code === "immutable_blueprint"
          ? tBackend("error.project.conflict")
          : tBackend("error.project.invalid");
  if (error instanceof CognitionPersistenceError) {
    switch (error.code) {
      case "not_found":
        throw new NotFoundException(messageFor(error.code));
      case "ownership_mismatch":
        throw new ForbiddenException(messageFor(error.code));
      case "idempotency_conflict":
      case "immutable_declaration":
        throw new ConflictException(messageFor(error.code));
      case "invalid_declaration":
      case "invalid_candidate":
      case "inactive_evidence":
        throw new BadRequestException(messageFor(error.code));
    }
  }
  if (!(error instanceof ProjectValidationError)) throw error;
  switch (error.code) {
    case "not_found":
      throw new NotFoundException(messageFor(error.code));
    case "ownership_mismatch":
      throw new ForbiddenException(messageFor(error.code));
    case "immutable_blueprint":
    case "idempotency_conflict":
      throw new ConflictException(messageFor(error.code));
    case "invalid_blueprint":
    case "invalid_attempt":
    case "undeclared_evaluator":
      throw new BadRequestException(messageFor(error.code));
  }
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly learningSpaceOrm: LearningSpaceOrmProvider,
    @Optional()
    @Inject(LEARNER_STATE_MEMORY_INVALIDATION_REPOSITORY)
    private readonly learnerStateMemoryInvalidation?: LearnerStateMemoryInvalidationRepository,
  ) {}

  async listProjects(userId: string, goalId: string) {
    const projects = await this.learningSpaceOrm.projectExperience.listProjects({ userId, goalId });
    if (!projects) throw new NotFoundException(tBackend("error.goal.notFound"));

    const projectRows = projects as Array<Record<string, unknown> & {
      attempts: Array<Record<string, unknown>>;
      milestones: Array<Record<string, unknown> & { attempts: Array<Record<string, unknown>> }>;
    }>;
    return {
      projects: projectRows.map(({ attempts, milestones, ...project }) => ({
        ...project,
        latestAttempt: attempts[0] ?? null,
        milestones: milestones.map(({ attempts: childAttempts, ...child }) => ({
          ...child,
          latestAttempt: childAttempts[0] ?? null,
        })),
      })),
    };
  }

  async getProject(userId: string, projectId: string) {
    const project = await this.learningSpaceOrm.projectExperience.findProject({ userId, projectId });
    if (!project) throw new NotFoundException(tBackend("error.notFound"));

    const { attempts, milestones, ...root } = project as Record<string, unknown> & {
      attempts: Array<Record<string, unknown>>;
      milestones: Array<Record<string, unknown> & { attempts: Array<Record<string, unknown>> }>;
    };
    return {
      project: {
        ...root,
        latestAttempt: attempts[0] ?? null,
        milestones: milestones.map(({ attempts: childAttempts, ...child }) => ({
          ...child,
          latestAttempt: childAttempts[0] ?? null,
        })),
      },
    };
  }

  async listPendingReviewAttempts(limitRaw?: string) {
    const parsed = Number(limitRaw);
    const limit = Number.isInteger(parsed)
      ? Math.min(Math.max(parsed, 1), 100)
      : 50;
    const attempts = await this.learningSpaceOrm.projectExperience.listPendingReviewAttempts({ limit });
    return { attempts };
  }

  async getPendingReviewAttempt(attemptId: string) {
    const attempt = await this.learningSpaceOrm.projectExperience.findPendingReviewAttempt(attemptId);
    if (!attempt) throw new NotFoundException(tBackend("error.notFound"));
    return { attempt };
  }

  async submitMilestoneAttempt(
    userId: string,
    projectId: string,
    milestoneId: string,
    body: unknown,
  ) {
    const milestone = await this.learningSpaceOrm.projectExperience.findOwnedMilestone({ userId, projectId, milestoneId });
    if (!milestone) throw new NotFoundException(tBackend("error.notFound"));

    try {
      const submission = parseLearnerProjectAttemptSubmission(body);
      const payload = {
        artifactVersionRefs: submission.artifactVersionRefs,
        processLog: submission.processLog,
        assistanceTrace: submission.assistanceTrace,
        durationMs: submission.durationMs,
        status: "submitted" as const,
        submittedAt: new Date(),
      };
      const validated = validateProjectAttemptPayload(
        payload,
        milestone.deliverableDefinitions as never[],
      );
      const level = {
        independent: 0,
        light_hint: 0.25,
        guided: 0.55,
        worked_example: 0.8,
        answer_revealed: 1,
      }[validated.assistance.level];
      const result = await this.learningSpaceOrm.taskAttempt.start({
        taskId: String(milestone.id),
        userId,
        ...(typeof milestone.unitId === "string" ? { unitId: milestone.unitId } : {}),
        idempotencyKey: submission.idempotencyKey,
        context: {
          project: {
            rootTaskId: String(milestone.parentTaskId ?? milestone.id),
            projectRole: String(milestone.projectRole),
            milestoneOrder: milestone.milestoneOrder ?? null,
            blueprintHash: String(milestone.projectBlueprintHash ?? ""),
          },
        },
        response: {},
        artifactRefs: validated.artifactKeys,
        artifactVersionRefs: submission.artifactVersionRefs,
        processLog: submission.processLog,
        assistanceTrace: submission.assistanceTrace,
        assistanceLevel: level,
        hintCount: validated.assistance.hintCount,
        ...(submission.durationMs ? { durationMs: submission.durationMs } : {}),
        status: "submitted",
        submittedAt: payload.submittedAt,
      });
      const deterministic = await this.learningSpaceOrm.projectExperience.runDeterministicRubric({ userId, attemptId: result.attempt.id });
      const completedAt =
        deterministic.completedAt ?? result.attempt.completedAt ?? null;
      if (completedAt) {
        await invalidateLearnerStateMemory(
          userId,
          "project_assessment_completed",
          undefined,
          this.learnerStateMemoryInvalidation,
        );
      }
      return {
        attempt: {
          ...result.attempt,
          status: deterministic.attemptStatus,
          completedAt,
        },
        replayed: result.replayed,
      };
    } catch (error) {
      rethrowProjectError(error);
    }
  }

  async createTestProject(body: unknown) {
    const goalId =
      typeof body === "object" &&
      body !== null &&
      "goalId" in body &&
      typeof (body as { goalId?: unknown }).goalId === "string"
        ? (body as { goalId: string }).goalId
        : "";
    const modeValue =
      typeof body === "object" &&
      body !== null &&
      "mode" in body &&
      typeof (body as { mode?: unknown }).mode === "string"
        ? (body as { mode: string }).mode
        : undefined;
    const mode =
      modeValue === undefined ? undefined : (modeValue as AdminTestProjectMode);
    try {
      return await this.learningSpaceOrm.projectExperience.createAdminTestProject({ goalId, mode: mode ?? "fixture" });
    } catch (error) {
      rethrowProjectError(error);
    }
  }

  async recordObservation(
    adminUserId: string,
    attemptId: string,
    body: unknown,
  ) {
    const attemptUserId = await this.learningSpaceOrm.projectExperience.findAttemptOwner(attemptId);
    if (!attemptUserId) throw new NotFoundException(tBackend("error.notFound"));

    try {
      const submission = parseProjectObservationSubmission(body);
      return await this.learningSpaceOrm.projectExperience.recordAuthoritativeObservation({
        actorRef: adminUserId,
        userId: attemptUserId,
        attemptId,
        requirementId: submission.requirementId,
        score: submission.score,
        evaluatorRunId: submission.evaluatorRunId,
        rawResult: submission.rawResult,
        metadata: {
          ...(submission.metadata ?? {}),
          reviewedByAdminUserId: adminUserId,
        },
      });
    } catch (error) {
      rethrowProjectError(error);
    }
  }
}
