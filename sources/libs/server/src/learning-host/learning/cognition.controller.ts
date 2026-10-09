import { Controller, Get, Param } from "@nestjs/common";
import { CurrentUserId } from "../../../../common/src/index.js";
import { LearningService } from "./learning.service.js";

@Controller("api/cognition/entities/:entityId")
export class CognitionController {
  constructor(private readonly learning: LearningService) {}

  @Get("state")
  getState(
    @CurrentUserId() userId: string,
    @Param("entityId") entityId: string,
  ) {
    return this.learning.getCognitiveEntityState(userId, entityId);
  }

  @Get("evidence")
  getEvidence(
    @CurrentUserId() userId: string,
    @Param("entityId") entityId: string,
  ) {
    return this.learning.getCognitiveEntityEvidence(userId, entityId);
  }
}
