import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { LearningSpaceError } from "../../learning-spaces/errors.js";
import type { MikroOrmLearningSpaceApplicationService } from "../../learning-spaces/orm-application-service.js";
import type { PlannedGoalBrief } from "../../../../domain/src/index.js";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";

function translateError(error: unknown): never {
  if (!(error instanceof LearningSpaceError)) throw error;
  if (error.code === "not_found") throw new NotFoundException(error.message);
  if (error.code === "duplicate_name" || error.code === "stale") {
    throw new ConflictException({ code: error.code, message: error.message });
  }
  throw new BadRequestException({ code: error.code, message: error.message });
}

@Injectable()
export class LearningSpacesService {
  constructor(private readonly orm: LearningSpaceOrmProvider) {}

  private get application(): MikroOrmLearningSpaceApplicationService {
    return this.orm.service;
  }

  portfolio(userId: string) {
    return this.application.portfolio(userId).catch(translateError);
  }

  detail(userId: string, spaceId: string) {
    return this.application.detail(userId, spaceId).catch(translateError);
  }

  async create(userId: string, body: { name: string; purpose?: string }) {
    try {
      return await this.application.create(userId, body);
    } catch (error) {
      return translateError(error);
    }
  }

  async update(
    userId: string,
    spaceId: string,
    body: { name?: string; purpose?: string },
  ) {
    try {
      return await this.application.update(userId, spaceId, body);
    } catch (error) {
      return translateError(error);
    }
  }

  delete(userId: string, spaceId: string) {
    return this.application.delete(userId, spaceId).catch(translateError);
  }

  reorder(userId: string, orderedSpaceIds: string[]) {
    return this.application
      .reorderSpaces(userId, orderedSpaceIds)
      .catch(translateError);
  }

  async createPlannedGoal(
    userId: string,
    spaceId: string,
    body: {
      title: string;
      rationale?: string;
      suggestedGoalKind?: string;
      goalBrief?: PlannedGoalBrief;
    },
  ) {
    try {
      const created = await this.application.createPlannedGoal(
        userId,
        spaceId,
        body,
      );
      const detail = await this.application.detail(userId, spaceId);
      return detail.items.find((item) => item.id === created.id)!;
    } catch (error) {
      return translateError(error);
    }
  }

  async updatePlannedGoal(
    userId: string,
    itemId: string,
    body: {
      title?: string;
      rationale?: string;
      suggestedGoalKind?: string;
      goalBrief?: PlannedGoalBrief | null;
    },
  ) {
    try {
      const updated = await this.application.updatePlannedGoal(
        userId,
        itemId,
        body,
      );
      const detail = await this.application.detail(userId, updated.spaceId);
      return detail.items.find((item) => item.id === updated.id)!;
    } catch (error) {
      return translateError(error);
    }
  }

  removeItem(userId: string, itemId: string) {
    return this.application.removeItem(userId, itemId).catch(translateError);
  }

  moveGoal(
    userId: string,
    goalId: string,
    body: { spaceId: string | null; includeFoundationGoalIds?: string[] },
  ) {
    return this.application
      .moveGoal(userId, goalId, body)
      .catch(translateError);
  }

  reorderItems(userId: string, spaceId: string, orderedItemIds: string[]) {
    return this.application
      .reorderItems(userId, spaceId, orderedItemIds)
      .catch(translateError);
  }

  createRelation(
    userId: string,
    spaceId: string,
    body: { fromItemId: string; toItemId: string; relationType: string },
  ) {
    return this.application
      .createRelation(userId, spaceId, body)
      .catch(translateError);
  }

  deleteRelation(userId: string, relationId: string) {
    return this.application
      .deleteRelation(userId, relationId)
      .catch(translateError);
  }
}
