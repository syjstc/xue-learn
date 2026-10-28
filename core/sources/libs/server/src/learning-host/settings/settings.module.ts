import { Module } from "@nestjs/common";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";

@Module({
  imports: [LearningSpacePersistenceModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
