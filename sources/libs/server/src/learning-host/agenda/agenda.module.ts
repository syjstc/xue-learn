import { Module } from "@nestjs/common";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";
import { AgendaController } from "./agenda.controller.js";
import { AgendaService } from "./agenda.service.js";

@Module({
  imports: [LearningSpacePersistenceModule],
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
