import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { CurrentUserId, localizeBackendPayload } from "../../../../common/src/index.js";
import type {
  AgentPageContext,
  DocumentGoalSeed,
  GoalCreationDraft,
} from "../../agents/index.js";
import type { Response } from "express";
import { AgentService, type AgentUploadFile } from "./agent.service.js";
import { GoalCreationSessionService } from "./goal-creation-session.service.js";

@Controller("api/agent")
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly goalCreationSessions: GoalCreationSessionService,
  ) {}

  @Post("goal-creation-sessions")
  createGoalCreationSession(@CurrentUserId() userId: string) {
    return this.goalCreationSessions.createOrGet(userId);
  }

  @Post("foundation-goals/:parentGoalId")
  async createFoundationGoal(
    @CurrentUserId() userId: string,
    @Param("parentGoalId") parentGoalId: string,
    @Body()
    body: {
      prerequisiteItems?: string[];
      learningMode?: "exploration" | "mastery";
    },
  ) {
    const result = await this.goalCreationSessions.createFoundationOrGet(
      userId,
      parentGoalId,
      body.prerequisiteItems,
      body.learningMode,
    );
    if (result.created && result.session) {
      this.agent.startGoalCreationInBackground(userId, result.session.threadId);
    }
    return result;
  }

  @Get("goal-creation-sessions/active")
  getActiveGoalCreationSession(@CurrentUserId() userId: string) {
    return this.goalCreationSessions.getActive(userId);
  }

  @Get("goal-creation-sessions/by-goal/:goalId")
  getGoalCreationSessionByGoal(
    @CurrentUserId() userId: string,
    @Param("goalId") goalId: string,
  ) {
    return this.goalCreationSessions.getByGoal(userId, goalId);
  }

  @Get("goal-creation-sessions/:sessionId")
  getGoalCreationSession(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.goalCreationSessions.snapshot(userId, sessionId);
  }

  @Get("goal-creation-sessions/:sessionId/events")
  getGoalCreationSessionEvents(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
    @Query("after") after?: string,
  ) {
    return this.goalCreationSessions.listEvents(
      userId,
      sessionId,
      Number.parseInt(after ?? "0", 10) || 0,
    );
  }

  @Get("goal-creation-sessions/:sessionId/events/stream")
  async streamGoalCreationSessionEvents(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
    @Res() res: Response,
    @Query("after") after?: string,
  ) {
    let cursor = Number.parseInt(after ?? "0", 10) || 0;
    let closed = false;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const onClose = () => {
      closed = true;
    };
    res.once("close", onClose);
    try {
      while (!closed) {
        const page = await this.goalCreationSessions.listEvents(
          userId,
          sessionId,
          cursor,
        );
        for (const event of page.events) {
          cursor = event.sequence;
          res.write(
            `id: ${event.sequence}\ndata: ${JSON.stringify(localizeBackendPayload(event))}\n\n`,
          );
        }
        if (page.events.length === 0) res.write(": keepalive\n\n");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } finally {
      res.off("close", onClose);
      if (!res.writableEnded) res.end();
    }
  }

  @Post("goal-creation-sessions/:sessionId/retry")
  async retryGoalCreationSession(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
  ) {
    const result = await this.goalCreationSessions.retry(userId, sessionId);
    if (result.session.status === "running") {
      this.agent.startGoalCreationInBackground(
        userId,
        result.session.threadId,
      );
    }
    return result;
  }

  @Post("goal-creation-sessions/:sessionId/stop")
  async stopGoalCreationSession(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
  ) {
    const snapshot = await this.goalCreationSessions.snapshot(
      userId,
      sessionId,
    );
    this.agent.abortThreadRun(snapshot.session.threadId);
    return this.goalCreationSessions.stop(userId, sessionId);
  }

  @Post("goal-creation-sessions/:sessionId/message")
  async sendGoalCreationSessionMessage(
    @CurrentUserId() userId: string,
    @Res() res: Response,
    @Param("sessionId") sessionId: string,
    @Body()
    body: {
      message: string;
      pageContext?: AgentPageContext;
      clientAction?: string;
      seedTopic?: string;
      documentSeed?: DocumentGoalSeed;
      isSmallCourse?: boolean;
      goalDraft?: GoalCreationDraft;
    },
  ) {
    const threadId = await this.goalCreationSessions.requireThreadId(
      userId,
      sessionId,
    );
    await this.agent.streamMessage(
      userId,
      threadId,
      body.message,
      res,
      body.pageContext,
      {
        clientAction: body.clientAction,
        seedTopic: body.seedTopic,
        documentSeed: body.documentSeed,
        isSmallCourse: body.isSmallCourse,
        goalDraft: body.goalDraft,
      },
    );
  }

  @Post("goal-creation-sessions/:sessionId/resume-interaction")
  async resumeGoalCreationSessionInteraction(
    @CurrentUserId() userId: string,
    @Res() res: Response,
    @Param("sessionId") sessionId: string,
    @Body() body: { toolCallId: string; result: unknown },
  ) {
    const threadId = await this.goalCreationSessions.requireThreadId(
      userId,
      sessionId,
    );
    await this.agent.streamResume(
      userId,
      threadId,
      body.toolCallId,
      body.result,
      res,
    );
  }

  @Post("goal-creation-sessions/:sessionId/documents")
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: "files", maxCount: 20 },
      { name: "file", maxCount: 1 },
    ]),
  )
  async storeGoalCreationSessionDocuments(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
    @UploadedFiles()
    uploads: { files?: AgentUploadFile[]; file?: AgentUploadFile[] },
  ) {
    const threadId = await this.goalCreationSessions.requireThreadId(
      userId,
      sessionId,
    );
    const files = uploads.files?.length ? uploads.files : (uploads.file ?? []);
    return this.agent.storePendingGoalDocuments(userId, threadId, files);
  }

  @Post("goal-creation-sessions/:sessionId/documents/analyze")
  async analyzeGoalCreationSessionDocuments(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
  ) {
    const threadId = await this.goalCreationSessions.requireThreadId(
      userId,
      sessionId,
    );
    return this.agent.analyzePendingGoalDocuments(userId, threadId);
  }

  @Post("goal-creation-sessions/:sessionId/urls")
  async storeGoalCreationSessionUrls(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: { urls?: string[] },
  ) {
    const threadId = await this.goalCreationSessions.requireThreadId(
      userId,
      sessionId,
    );
    return this.agent.storePendingGoalUrls(userId, threadId, body.urls ?? []);
  }

  @Delete("goal-creation-sessions/:sessionId")
  async deleteGoalCreationSession(
    @CurrentUserId() userId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: { confirm?: string },
  ) {
    return this.goalCreationSessions.remove(
      userId,
      sessionId,
      body.confirm ?? "",
    );
  }

  @Post("threads")
  createThread(
    @CurrentUserId() userId: string,
    @Body()
    body: {
      scope: string;
      scopeId?: string;
      fresh?: boolean;
      conversationContext?: import("../../agents/core/types.js").AssistantConversationContext;
    },
  ) {
    return this.agent.createThread(userId, body);
  }

  @Get("threads")
  listThreads(@CurrentUserId() userId: string, @Query("scope") scope?: string) {
    return this.agent.listThreads(userId, scope);
  }

  @Get("threads/global/briefing")
  globalBriefing(@CurrentUserId() userId: string) {
    return this.agent.getGlobalBriefing(userId);
  }

  @Get("time")
  getTime(@Query("timezone") timezone?: string) {
    return this.agent.getCurrentTime(timezone);
  }

  @Get("goals/search")
  searchGoals(
    @CurrentUserId() userId: string,
    @Query("since") since?: string,
    @Query("until") until?: string,
    @Query("dateField") dateField?: "updated" | "created",
    @Query("status") status?: "active" | "all",
    @Query("query") query?: string,
    @Query("limit") limit?: string,
  ) {
    return this.agent.searchGoals(userId, {
      since,
      until,
      dateField,
      status,
      query,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("activity/recent")
  recentActivity(
    @CurrentUserId() userId: string,
    @Query("limit") limit?: string,
  ) {
    return this.agent.getRecentActivity(
      userId,
      limit ? Number(limit) : undefined,
    );
  }

  @Get("threads/:id")
  getThread(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
  ) {
    return this.agent.getThread(userId, id, {
      limit: limit ? Number(limit) : undefined,
      before,
    });
  }

  @Post("threads/:id/message")
  async sendMessage(
    @CurrentUserId() userId: string,
    @Res() res: Response,
    @Param("id") id: string,
    @Body()
    body: {
      message: string;
      pageContext?: AgentPageContext;
      clientAction?: string;
      seedTopic?: string;
      documentSeed?: DocumentGoalSeed;
      isSmallCourse?: boolean;
      goalDraft?: GoalCreationDraft;
    },
  ) {
    await this.agent.streamMessage(
      userId,
      id,
      body.message,
      res,
      body.pageContext,
      {
        clientAction: body.clientAction,
        seedTopic: body.seedTopic,
        documentSeed: body.documentSeed,
        isSmallCourse: body.isSmallCourse,
        goalDraft: body.goalDraft,
      },
    );
  }

  @Post("threads/:id/documents/analyze")
  analyzePendingDocuments(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ) {
    return this.agent.analyzePendingGoalDocuments(userId, id);
  }

  @Post("threads/:id/urls")
  storePendingUrls(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() body: { urls?: string[] },
  ) {
    return this.agent.storePendingGoalUrls(userId, id, body.urls ?? []);
  }

  @Post("threads/:id/documents")
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: "files", maxCount: 20 },
      { name: "file", maxCount: 1 },
    ]),
  )
  storePendingDocuments(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @UploadedFiles()
    uploads: { files?: AgentUploadFile[]; file?: AgentUploadFile[] },
  ) {
    const files = uploads.files?.length ? uploads.files : (uploads.file ?? []);
    return this.agent.storePendingGoalDocuments(userId, id, files);
  }

  @Post("threads/:id/resume")
  async resume(
    @CurrentUserId() userId: string,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: { toolCallId: string; result: unknown },
  ) {
    await this.agent.streamResume(
      userId,
      id,
      body.toolCallId,
      body.result,
      res,
    );
  }

  @Post("threads/:id/cancel")
  cancel(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.agent.cancel(userId, id);
  }

  @Post("threads/:id/clear")
  clear(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.agent.clearThread(userId, id);
  }

  @Post("threads/:id/context/clear")
  clearContext(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.agent.clearThreadContext(userId, id);
  }

  @Delete("threads/:id")
  remove(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.agent.deleteThread(userId, id);
  }
}
