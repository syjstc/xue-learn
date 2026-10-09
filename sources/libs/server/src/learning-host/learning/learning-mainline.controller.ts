import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  Query,
  Param,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { CurrentUserId } from "../../../../common/src/index.js";
import {
  learningMainlineEnabled,
  learningMainlinePersistence,
} from "../../learning-mainline/persistence.js";
import { mainlineCommandSchema } from "../../learning-mainline/contracts.js";
import {
  MainlineConflict,
  MainlineUnavailable,
} from "../../learning-mainline/errors.js";
import { z } from "zod";
@Controller("api/learning-trajectory/mainline")
export class LearningMainlineController {
  private repo() {
    if (!learningMainlineEnabled()) throw new NotFoundException();
    return learningMainlinePersistence();
  }
  @Get("activities/:id/position")
  async resolve(@CurrentUserId() userId: string, @Param("id") id: string) {
    const resolved = await this.repo().resolve(userId, id);
    if (!resolved) throw new NotFoundException();
    return resolved;
  }
  @Get()
  snapshot(
    @CurrentUserId() userId: string,
    @Query("sessionId") sessionId: string,
  ) {
    if (!sessionId || sessionId.length > 160) throw new BadRequestException();
    return this.repo().snapshot(userId, sessionId);
  }
  @Get("next")
  next(@CurrentUserId() userId: string, @Query() query: unknown) {
    const result = z
      .object({
        sessionId: z.string().min(1).max(160),
        goalId: z.string().max(160).optional(),
        boundary: z.enum(["true", "false"]).optional(),
        timeLimitMinutes: z.coerce.number().min(1).max(1440).optional(),
      })
      .safeParse(query);
    if (!result.success) throw new BadRequestException();
    return this.repo().decision(userId, {
      ...result.data,
      boundary: result.data.boundary === "true",
    });
  }
  @Post("commands")
  @HttpCode(200)
  async command(@CurrentUserId() userId: string, @Body() body: unknown) {
    const result = mainlineCommandSchema.safeParse(body);
    if (!result.success) throw new BadRequestException();
    try {
      return await this.repo().command(userId, result.data);
    } catch (error) {
      if (error instanceof MainlineConflict) throw new ConflictException();
      if (error instanceof MainlineUnavailable) throw new NotFoundException();
      throw error;
    }
  }
}
