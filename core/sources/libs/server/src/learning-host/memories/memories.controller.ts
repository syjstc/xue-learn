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
import { MemoriesService } from "./memories.service.js";

@Controller("api")
@UseGuards(RequireAuthGuard)
export class MemoriesController {
  constructor(private readonly memories: MemoriesService) {}

  @Get("memories")
  list(
    @CurrentUserId() userId: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.memories.list(userId, query);
  }

  @Post("memories")
  create(@CurrentUserId() userId: string, @Body() body: unknown) {
    return this.memories.create(userId, body);
  }

  @Get("memories/:id")
  get(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.memories.get(userId, id);
  }

  @Patch("memories/:id")
  correct(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.memories.correct(userId, id, body);
  }

  @Post("memories/:id/archive")
  archive(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.memories.archive(userId, id);
  }

  @Delete("memories/:id")
  remove(@CurrentUserId() userId: string, @Param("id") id: string) {
    return this.memories.remove(userId, id);
  }

  @Get("memory-candidates")
  listCandidates(
    @CurrentUserId() userId: string,
    @Query("status") status?: string,
  ) {
    return this.memories.listCandidates(userId, status);
  }

  @Post("memory-candidates/:id/resolve")
  resolveCandidate(
    @CurrentUserId() userId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.memories.resolveCandidate(userId, id, body);
  }
}
