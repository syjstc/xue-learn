import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { CurrentUserId } from "../../../../common/src/index.js";
import type { PlannedGoalBrief } from "../../../../domain/src/index.js";
import { LearningSpacesService } from "./learning-spaces.service.js";

@Controller("api/learning-spaces")
export class LearningSpacesController {
  constructor(private readonly spaces: LearningSpacesService) {}

  @Get()
  portfolio(@CurrentUserId() userId: string) {
    return this.spaces.portfolio(userId);
  }

  @Post()
  create(@CurrentUserId() userId: string, @Body() body: { name: string; purpose?: string }) {
    return this.spaces.create(userId, body);
  }

  @Get(":spaceId")
  detail(@CurrentUserId() userId: string, @Param("spaceId") spaceId: string) {
    return this.spaces.detail(userId, spaceId);
  }

  @Put("order")
  reorder(@CurrentUserId() userId: string, @Body() body: { orderedSpaceIds?: string[] }) {
    return this.spaces.reorder(userId, body.orderedSpaceIds ?? []);
  }

  @Patch(":spaceId")
  update(
    @CurrentUserId() userId: string,
    @Param("spaceId") spaceId: string,
    @Body() body: { name?: string; purpose?: string },
  ) {
    return this.spaces.update(userId, spaceId, body);
  }

  @Delete(":spaceId")
  delete(@CurrentUserId() userId: string, @Param("spaceId") spaceId: string) {
    return this.spaces.delete(userId, spaceId);
  }

  @Post(":spaceId/planned-goals")
  createPlannedGoal(
    @CurrentUserId() userId: string,
    @Param("spaceId") spaceId: string,
    @Body()
    body: {
      title: string;
      rationale?: string;
      suggestedGoalKind?: string;
      goalBrief?: PlannedGoalBrief;
    },
  ) {
    return this.spaces.createPlannedGoal(userId, spaceId, body);
  }

  @Put(":spaceId/items/order")
  reorderItems(
    @CurrentUserId() userId: string,
    @Param("spaceId") spaceId: string,
    @Body() body: { orderedItemIds?: string[] },
  ) {
    return this.spaces.reorderItems(userId, spaceId, body.orderedItemIds ?? []);
  }

  @Post(":spaceId/relations")
  createRelation(
    @CurrentUserId() userId: string,
    @Param("spaceId") spaceId: string,
    @Body() body: { fromItemId: string; toItemId: string; relationType: string },
  ) {
    return this.spaces.createRelation(userId, spaceId, body);
  }

  @Patch("items/:itemId")
  updatePlannedGoal(
    @CurrentUserId() userId: string,
    @Param("itemId") itemId: string,
    @Body()
    body: {
      title?: string;
      rationale?: string;
      suggestedGoalKind?: string;
      goalBrief?: PlannedGoalBrief | null;
    },
  ) {
    return this.spaces.updatePlannedGoal(userId, itemId, body);
  }

  @Delete("items/:itemId")
  removeItem(@CurrentUserId() userId: string, @Param("itemId") itemId: string) {
    return this.spaces.removeItem(userId, itemId);
  }

  @Delete("relations/:relationId")
  deleteRelation(@CurrentUserId() userId: string, @Param("relationId") relationId: string) {
    return this.spaces.deleteRelation(userId, relationId);
  }

  @Put("goals/:goalId")
  moveGoal(
    @CurrentUserId() userId: string,
    @Param("goalId") goalId: string,
    @Body() body: { spaceId: string | null; includeFoundationGoalIds?: string[] },
  ) {
    return this.spaces.moveGoal(userId, goalId, body);
  }
}
