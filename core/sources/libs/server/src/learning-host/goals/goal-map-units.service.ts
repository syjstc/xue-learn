import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import { invalidateAgendaForUser } from "../../agenda/index.js";
import type {
  CognitiveModelInvalidationRepository,
  LegacyMapUnitMutationFailureStatus,
} from "../../../../domain/src/index.js";
import { COGNITIVE_MODEL_INVALIDATION_REPOSITORY } from "../../learning-spaces/cognitive-model-invalidation-token.js";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";
import { serializeBranchUnit } from "./goal-serialize.util.js";

@Injectable()
export class GoalMapUnitsService {
  constructor(
    @Inject(COGNITIVE_MODEL_INVALIDATION_REPOSITORY)
    private readonly cognitiveModelInvalidation: CognitiveModelInvalidationRepository,
    private readonly learningSpaceOrm: LearningSpaceOrmProvider,
  ) {}

  private throwMapMutationFailure(
    status: LegacyMapUnitMutationFailureStatus,
  ): never {
    switch (status) {
      case "goal_not_found":
        throw new NotFoundException(tBackend("error.goal.notFound"));
      case "goal_forbidden":
        throw new ForbiddenException(tBackend("error.goal.forbidden"));
      case "immutable_goal":
        throw new ConflictException({
          code: "MODULE_CURRICULUM_IMMUTABLE",
          message: tBackend("error.goal.approvedCourseReadonly"),
        });
      case "unit_not_found":
      case "parent_not_found":
        throw new NotFoundException(tBackend("error.goal.unitNotFound"));
      case "overview_readonly":
        throw new BadRequestException(
          tBackend("error.goal.overviewUnitReadonly"),
        );
      case "title_required":
        throw new BadRequestException(tBackend("error.goal.titleRequired"));
      case "invalid_edit":
        throw new BadRequestException(tBackend("error.goal.invalidMapEdit"));
    }
  }

  private async invalidate(userId: string, goalId: string, reason: string) {
    await this.cognitiveModelInvalidation.invalidate({ goalId, reason });
    await invalidateAgendaForUser(userId);
  }

  async createBranchUnit(
    userId: string,
    goalId: string,
    body: {
      title: string;
      contentSummary?: string;
      note?: string;
      parentUnitId?: string | null;
      unitKind?: string;
    },
  ) {
    const parentUnitId = body.parentUnitId ?? null;
    const unitKind = parentUnitId
      ? body.unitKind === "module"
        ? "module"
        : "lesson"
      : "branch";
    const result =
      await this.learningSpaceOrm.legacyMapUnitMutation.createOwnedEditableUnit(
        {
          userId,
          goalId,
          parentUnitId,
          unitKind,
          title: body.title ?? "",
          contentSummary: body.contentSummary?.trim() ?? "",
          note: body.note?.trim() ?? "",
          mapOrigin: parentUnitId || unitKind === "branch" ? "user" : "llm",
        },
      );
    if (result.status !== "created") {
      this.throwMapMutationFailure(result.status);
    }
    await this.invalidate(userId, goalId, "map_unit_created");
    return { unit: serializeBranchUnit(result.unit) };
  }

  async updateBranchUnit(
    userId: string,
    goalId: string,
    unitId: string,
    body: {
      title?: string;
      contentSummary?: string;
      note?: string;
      parentUnitId?: string | null;
      orderIndex?: number;
    },
  ) {
    const hasParentUpdate = Object.prototype.hasOwnProperty.call(
      body,
      "parentUnitId",
    );
    const result =
      await this.learningSpaceOrm.legacyMapUnitMutation.updateOwnedEditableUnit(
        {
          userId,
          goalId,
          unitId,
          ...(typeof body.title === "string" ? { title: body.title } : {}),
          ...(typeof body.contentSummary === "string"
            ? { contentSummary: body.contentSummary }
            : {}),
          ...(typeof body.note === "string" ? { note: body.note } : {}),
          ...(hasParentUpdate
            ? { parentUnitId: body.parentUnitId ?? null }
            : {}),
          ...(typeof body.orderIndex === "number"
            ? { orderIndex: body.orderIndex }
            : {}),
        },
      );
    if (result.status !== "updated") {
      this.throwMapMutationFailure(result.status);
    }
    await this.invalidate(userId, goalId, "map_unit_updated");
    return { unit: serializeBranchUnit(result.unit) };
  }

  async reorderGoalUnits(
    userId: string,
    goalId: string,
    body: { parentUnitId?: string | null; orderedUnitIds?: string[] },
  ) {
    const orderedUnitIds = Array.isArray(body.orderedUnitIds)
      ? body.orderedUnitIds.filter(
          (id): id is string => typeof id === "string" && Boolean(id),
        )
      : [];
    const result =
      await this.learningSpaceOrm.legacyMapUnitMutation.reorderOwnedEditableUnits(
        {
          userId,
          goalId,
          parentUnitId: body.parentUnitId ?? null,
          orderedUnitIds,
        },
      );
    if (result.status !== "reordered") {
      this.throwMapMutationFailure(result.status);
    }
    await this.invalidate(userId, goalId, "map_units_reordered");
    return { units: result.units.map((unit) => serializeBranchUnit(unit)) };
  }

  async deleteBranchUnit(userId: string, goalId: string, unitId: string) {
    const result =
      await this.learningSpaceOrm.legacyMapUnitMutation.deleteOwnedEditableUnit(
        {
          userId,
          goalId,
          unitId,
        },
      );
    if (result.status !== "deleted") {
      this.throwMapMutationFailure(result.status);
    }
    await this.invalidate(userId, goalId, "map_unit_deleted");
    return { ok: true };
  }
}
