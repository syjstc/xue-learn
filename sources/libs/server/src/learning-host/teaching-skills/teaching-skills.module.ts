import { Module } from "@nestjs/common";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";
import { TeachingSkillsService } from "./teaching-skills.service.js";

@Module({
  imports: [LearningSpacePersistenceModule],
  providers: [TeachingSkillsService],
  exports: [TeachingSkillsService],
})
export class TeachingSkillsModule {}
