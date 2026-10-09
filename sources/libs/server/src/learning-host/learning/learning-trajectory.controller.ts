import { recordLearningFeedback } from "../../learning-trajectory/feedback.js";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { CurrentUserId } from "../../../../common/src/index.js";
import { z } from "zod";
import {
  learningTrajectoryEnabled,
  learningTrajectoryPersistence,
} from "../../learning-trajectory/persistence.js";
import { learningPositionSchema } from "../../learning-trajectory/contracts.js";
import {
  learningBranchAction,
  learningBranchDetail,
  learningGuidancePreferences,
  resolveOwnedLearningPosition,
  saveLearningGuidancePreferences,
} from "../../learning-trajectory/service.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new BadRequestException("Invalid learning position or action");
  return parsed.data;
}
@Controller("api/learning-trajectory")
export class LearningTrajectoryController {
  constructor(private readonly orm: LearningSpaceOrmProvider) {}
  private requireEnabled() {
    if (!learningTrajectoryEnabled()) throw new NotFoundException();
    return learningTrajectoryPersistence();
  }
  @Get()
  async snapshot(
    @CurrentUserId() userId: string,
    @Query("unitId") unitId?: string,
    @Query("cursor") cursor?: string,
  ) {
    const repo = this.requireEnabled();
    if (unitId && !(await repo.context(userId, unitId)))
      throw new NotFoundException();
    return repo.snapshot({ userId, unitId, cursor, limit: 30 });
  }
  @Get("preferences")
  preferences(@CurrentUserId() userId: string) {
    this.requireEnabled();
    return learningGuidancePreferences(userId);
  }
  @Post("preferences")
  savePreferences(@CurrentUserId() userId: string, @Body() body: unknown) {
    this.requireEnabled();
    return saveLearningGuidancePreferences(
      userId,
      parse(
        z
          .object({
            autoSaveSupplements: z.boolean().optional(),
            proactiveGuidance: z.boolean().optional(),
          })
          .strict(),
        body,
      ),
    );
  }
  @Get("branches/:id")
  async detail(@CurrentUserId() userId: string, @Param("id") id: string) {
    this.requireEnabled();
    const detail = await learningBranchDetail(userId, id);
    if (!detail) throw new NotFoundException();
    return detail;
  }
  @Post("branches/:id/actions")
  async branchAction(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.requireEnabled();
    const v = parse(
      z.object({
        revision: z.number().int().min(0),
        action: z.enum(["cancel", "dismiss", "defer", "resume", "retry"]),
      }),
      body,
    );
    const result = await learningBranchAction(userId, id, v.revision, v.action);
    if (!result)
      throw new ConflictException(
        "Learning content changed; refresh and retry",
      );
    return result;
  }
  @Post("branches/:id/enter")
  async enter(
    @CurrentUserId() userId: string,
    @Param("id") branchId: string,
    @Body() body: unknown,
  ) {
    const repo = this.requireEnabled();
    const v = parse(
      z.object({
        visitId: z.string().uuid(),
        sessionId: z.string().min(1).max(160),
        returnPosition: learningPositionSchema,
      }),
      body,
    );
    const resolved = await resolveOwnedLearningPosition(
      userId,
      v.returnPosition,
    );
    return repo.enter({
      userId,
      branchId,
      ...v,
      returnPosition: resolved.position,
    });
  }
  @Post("visits/:id/actions")
  async visitAction(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const repo = this.requireEnabled();
    const v = parse(
      z.object({
        revision: z.number().int().min(0),
        action: z.enum(["position", "pause", "return"]),
        position: learningPositionSchema.optional(),
      }),
      body,
    );
    if (v.position)
      v.position = (
        await resolveOwnedLearningPosition(userId, v.position)
      ).position;
    const result = await repo.updateVisit({ userId, id, ...v });
    if (!result)
      throw new ConflictException(
        "Learning position changed; refresh and retry",
      );
    if (v.action === "return")
      await recordLearningFeedback({
        userId,
        unitId: result.unitId,
        eventId: `returned:${id}`,
        kind: "returned",
        visitId: id,
      });
    return result;
  }
  @Post("visits/:id/feedback")
  async feedback(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const repo = this.requireEnabled();
    const v = parse(
      z
        .object({
          kind: z.enum(["understood", "content_finished"]),
          eventId: z.string().uuid(),
        })
        .strict(),
      body,
    );
    const visit = await repo.visit(userId, id);
    if (!visit) throw new NotFoundException();
    await recordLearningFeedback({
      userId,
      unitId: visit.unitId,
      visitId: id,
      eventId: `${id}:${v.kind}`,
      kind: v.kind,
    });
    return { message: "" };
  }
  @Get("visits/:id")
  async visit(@CurrentUserId() userId: string, @Param("id") id: string) {
    const result = await this.requireEnabled().visit(userId, id);
    if (!result) throw new NotFoundException();
    return result;
  }
  @Post("resolve-position")
  async resolvePosition(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ) {
    this.requireEnabled();
    const result = await resolveOwnedLearningPosition(
      userId,
      parse(learningPositionSchema, body),
    );
    return { position: result.position, exact: result.exact };
  }
  @Post("branches/:id/confirm-goal")
  async confirmGoal(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const repo = this.requireEnabled();
    const v = parse(z.object({ spaceId: z.string().min(1).max(160) }), body);
    const b = await repo.branch(userId, id);
    if (!b || b.kind !== "goal" || b.status !== "proposed")
      throw new NotFoundException();
    const context = await repo.context(userId, b.unitId);
    if (!context) throw new NotFoundException();
    const planned = await this.orm.service.createPlannedGoal(
      userId,
      v.spaceId,
      {
        title: b.title,
        rationale: b.reason,
        suggestedGoalKind: "full",
        source: "assistant",
        requestId: `learning-branch:${b.id}`,
        goalBrief: {
          schemaVersion: 1,
          originalRequest: b.origin.anchorText || b.title,
          intendedOutcome: b.returnGoal,
          scopeIncluded: [b.title],
          scopeExcluded: [],
          prerequisites: [],
          desiredOutputs: [b.returnGoal],
          suggestedLevel: "basic",
          suggestedLearningMode: "exploration",
          suggestedPlanningMode: "fast",
          suggestedContentLanguage: context.locale,
        },
      },
    );
    await repo.linkPlannedGoal(userId, id, planned.id);
    return { plannedGoalId: planned.id, spaceId: planned.spaceId };
  }
}
