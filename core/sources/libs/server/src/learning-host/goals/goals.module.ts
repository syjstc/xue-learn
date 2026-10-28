import { Module } from "@nestjs/common";
import { GoalsController } from "./goals.controller.js";
import { GoalsService } from "./goals.service.js";
import { GoalCrudService } from "./goal-crud.service.js";
import { GoalMapUnitsService } from "./goal-map-units.service.js";
import { GoalDecomposeService } from "./goal-decompose.service.js";
import { GoalSummaryMicroService } from "./goal-summary-micro.service.js";
import { GoalPlanOverviewService } from "./goal-plan-overview.service.js";
import { GoalModulesService } from "./goal-modules.service.js";
import { LearningSpacesController } from "./learning-spaces.controller.js";
import { LearningSpacesService } from "./learning-spaces.service.js";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";
import { LearningSpacePersistenceModule } from "../../learning-spaces/learning-space-persistence.module.js";
import { MODULE_GENERATION_RETRY_REPOSITORY } from "../../learning-spaces/module-generation-retry-token.js";
import { EXPLORATION_CURRICULUM_READY_REPOSITORY } from "../../learning-spaces/exploration-curriculum-ready-token.js";
import { MODULE_STRUCTURE_QUEUE_REPOSITORY } from "../../learning-spaces/module-structure-queue-token.js";
import { COGNITIVE_MODEL_INVALIDATION_REPOSITORY } from "../../learning-spaces/cognitive-model-invalidation-token.js";
import { MODULE_ENTRY_READINESS_READ_REPOSITORY } from "../../learning-spaces/module-entry-readiness-read-token.js";
@Module({
    imports: [LearningSpacePersistenceModule],
    controllers: [GoalsController, LearningSpacesController],
    providers: [
        GoalsService,
        GoalCrudService,
        GoalMapUnitsService,
        GoalDecomposeService,
        GoalSummaryMicroService,
        GoalPlanOverviewService,
        GoalModulesService,
        LearningSpacesService,
        {
            provide: MODULE_GENERATION_RETRY_REPOSITORY,
            useFactory: (provider: LearningSpaceOrmProvider) => provider.afterInitialization(() => provider.moduleGenerationRetry),
            inject: [LearningSpaceOrmProvider],
        },
        {
            provide: EXPLORATION_CURRICULUM_READY_REPOSITORY,
            useFactory: (provider: LearningSpaceOrmProvider) => provider.afterInitialization(() => provider.explorationCurriculumReady),
            inject: [LearningSpaceOrmProvider],
        },
        {
            provide: MODULE_STRUCTURE_QUEUE_REPOSITORY,
            useFactory: (provider: LearningSpaceOrmProvider) => provider.afterInitialization(() => provider.moduleStructureQueue),
            inject: [LearningSpaceOrmProvider],
        },
        {
            provide: COGNITIVE_MODEL_INVALIDATION_REPOSITORY,
            useFactory: (provider: LearningSpaceOrmProvider) => provider.afterInitialization(() => provider.cognitiveModelInvalidation),
            inject: [LearningSpaceOrmProvider],
        },
        {
            provide: MODULE_ENTRY_READINESS_READ_REPOSITORY,
            useFactory: (provider: LearningSpaceOrmProvider) => provider.afterInitialization(() => provider.moduleEntryReadinessRead),
            inject: [LearningSpaceOrmProvider],
        },
    ],
})
export class GoalsModule {
}
