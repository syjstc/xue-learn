import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUserId } from "../../../../common/src/index.js";
import { LearningService } from "./learning.service.js";
import { pipeWebSseResponse } from "./sse.util.js";

@Controller("api/goals/:goalId/modules/:moduleId")
export class ModuleLearningController {
  constructor(private readonly learning: LearningService) {}

  @Get("diagnostic")
  getDiagnostic(
    @CurrentUserId() userId: string,
    @Param("goalId") goalId: string,
    @Param("moduleId") moduleId: string,
  ) {
    return this.learning.getModuleDiagnostic(userId, goalId, moduleId);
  }

  @Get("adaptive-assessment")
  getAdaptiveAssessment(
    @CurrentUserId() userId: string,
    @Param("goalId") goalId: string,
    @Param("moduleId") moduleId: string,
    @Query("purpose") purpose?: string,
  ) {
    return this.learning.getModuleAdaptiveAssessment(
      userId,
      goalId,
      moduleId,
      purpose === "readiness" ? "readiness" : "mastery",
    );
  }

  @Post("diagnostic/stream")
  async diagnosticStream(
    @CurrentUserId() userId: string,
    @Param("goalId") goalId: string,
    @Param("moduleId") moduleId: string,
    @Body() body: { runId?: string },
    @Res() res: Response,
  ) {
    const webRes = await this.learning.moduleDiagnosticStream(
      userId,
      goalId,
      moduleId,
      body,
    );
    await pipeWebSseResponse(webRes, res);
  }

  @Post("diagnostic/:attemptId/submit")
  submitDiagnostic(
    @CurrentUserId() userId: string,
    @Param("goalId") goalId: string,
    @Param("moduleId") moduleId: string,
    @Param("attemptId") attemptId: string,
    @Body()
    body: {
      answers?: Record<string, string | number | boolean | number[]>;
    },
  ) {
    return this.learning.submitModuleDiagnostic(
      userId,
      goalId,
      moduleId,
      attemptId,
      body.answers ?? {},
    );
  }
}
