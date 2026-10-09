import { Body, Controller, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUserId } from "../../../../common/src/index.js";
import { LearningService } from "./learning.service.js";
import { pipeWebSseResponse } from "./sse.util.js";

@Controller("api/assessments")
export class AdaptiveAssessmentController {
  constructor(private readonly learning: LearningService) {}

  @Post(":taskId/submit/stream")
  async submit(
    @CurrentUserId() userId: string,
    @Param("taskId") taskId: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const webRes = await this.learning.submitAdaptiveAssessmentStream(
      userId,
      taskId,
      body,
    );
    await pipeWebSseResponse(webRes, res);
  }
}
