import { Module } from "@nestjs/common";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";
import { AgentController } from "./agent.controller.js";
import { AgentService } from "./agent.service.js";
import { GoalCreationSessionService } from "./goal-creation-session.service.js";

@Module({
  imports: [LearningSpacePersistenceModule],
  controllers: [AgentController],
  providers: [AgentService, GoalCreationSessionService],
})
export class AgentModule {}
