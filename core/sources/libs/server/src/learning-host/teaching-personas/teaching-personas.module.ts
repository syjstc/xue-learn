import { Module } from "@nestjs/common";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";
import { TeachingPersonasController } from "./teaching-personas.controller.js";
import { TeachingPersonasService } from "./teaching-personas.service.js";

@Module({
  imports: [LearningSpacePersistenceModule],
  controllers: [TeachingPersonasController],
  providers: [TeachingPersonasService],
})
export class TeachingPersonasModule {}
