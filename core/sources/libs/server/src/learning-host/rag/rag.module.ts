import { Module } from "@nestjs/common";
import { RagController } from "./rag.controller.js";
import { RagService } from "./rag.service.js";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";

@Module({
  imports: [LearningSpacePersistenceModule],
  controllers: [RagController],
  providers: [RagService],
})
export class RagModule {}
