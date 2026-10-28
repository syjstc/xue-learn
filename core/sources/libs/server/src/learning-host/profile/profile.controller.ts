import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { RequireAuthGuard } from "../../../../common/src/index.js";
import { ProfileService } from "./profile.service.js";

@Controller('api/profile')
@UseGuards(RequireAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('learner')
  getLearner() {
    return this.profile.getLearner();
  }

  @Patch('learner')
  patchLearner(@Body() body: unknown) {
    return this.profile.patchLearner(body);
  }

  @Post('learner/knowledge')
  postKnowledge(@Body() body: unknown) {
    return this.profile.postKnowledge(body);
  }

  @Get('learning-state')
  getLearningState() {
    return this.profile.getLearningState();
  }
}
