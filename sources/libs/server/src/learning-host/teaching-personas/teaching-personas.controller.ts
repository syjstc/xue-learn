import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUserId, RequireAuthGuard } from "../../../../common/src/index.js";
import { TeachingPersonasService } from "./teaching-personas.service.js";

@Controller()
@UseGuards(RequireAuthGuard)
export class TeachingPersonasController {
  constructor(private readonly service: TeachingPersonasService) {}

  @Get("api/teaching-personas") list(
    @CurrentUserId() userId: string,
    @Query("goalId") goalId?: string,
  ) {
    return this.service.list(userId, goalId);
  }
  @Post("api/teaching-personas") create(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ) {
    return this.service.create(userId, body);
  }
  @Post("api/teaching-personas/preview") preview(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ) {
    return this.service.preview(userId, body);
  }
  @Patch("api/teaching-personas/:id") update(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(userId, id, body);
  }
  @Delete("api/teaching-personas/:id") remove(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
  ) {
    return this.service.remove(userId, id);
  }
  @Patch("api/settings/teaching-persona") selectGlobal(
    @CurrentUserId() userId: string,
    @Body() body: unknown,
  ) {
    return this.service.selectGlobal(userId, body);
  }
  @Patch("api/goals/:goalId/teaching-persona") selectGoal(
    @CurrentUserId() userId: string,
    @Param("goalId") goalId: string,
    @Body() body: unknown,
  ) {
    return this.service.selectGoal(userId, goalId, body);
  }
}
