import { Module } from "@nestjs/common";
import { ProfileController } from "./profile.controller.js";
import { ProfileService } from "./profile.service.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";
import { LEARNER_STATE_MEMORY_READ_REPOSITORY } from "../../learning-spaces/learner-state-memory-read-token.js";

@Module({
  imports: [LearningSpacePersistenceModule],
  controllers: [ProfileController],
  providers: [
    ProfileService,
    {
      provide: LEARNER_STATE_MEMORY_READ_REPOSITORY,
      useFactory: (provider: LearningSpaceOrmProvider) =>
        provider.afterInitialization(() => provider.learnerStateMemoryRead),
      inject: [LearningSpaceOrmProvider],
    },
  ],
})
export class ProfileModule {}
