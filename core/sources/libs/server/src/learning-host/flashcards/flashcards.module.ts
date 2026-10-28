import { Module } from "@nestjs/common";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";
import { FlashcardsController } from "./flashcards.controller.js";
import { FlashcardsService } from "./flashcards.service.js";

@Module({
  imports: [LearningSpacePersistenceModule],
  controllers: [FlashcardsController],
  providers: [FlashcardsService],
})
export class FlashcardsModule {}
