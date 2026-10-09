import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUserId } from "../../../../common/src/index.js";
import { LearningService } from "./learning.service.js";

@Controller("api/follow-ups")
export class FollowUpsController {
  constructor(private readonly learning: LearningService) {}

  @Get()
  listRecent(
    @CurrentUserId() userId: string,
    @Query("limit") limitParam?: string,
  ) {
    const parsed = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const limit =
      parsed != null && Number.isFinite(parsed) ? parsed : undefined;
    return this.learning.getRecentFollowUps(userId, limit);
  }
}
