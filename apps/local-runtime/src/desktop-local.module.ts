import {LocalWorkspaceLearningController,LOCAL_WORKSPACE_LEARNING_CONTEXT} from "./local-workspace-learning.controller.ts";
import type {WorkspaceLearningPort} from "@xue-learn/core/source/libs/domain/src/persistence/workspace-learning-port.ts";
import { SqliteLearningSpaceOrmProvider } from "@cognilearn/desktop-persistence/learning-space-orm.provider";
import { LearningSpacePersistenceModule } from "@xue-learn/core/source/libs/server/src/learning-spaces/learning-space-persistence.module.ts";
import { LOCAL_COURSE_SOURCE_CONTEXT, LocalCourseSourceController, type LocalCourseSourceContext } from "./local-course-source.controller.ts";
import { LOCAL_WORKSPACE_SERVICE_CONTEXT, LocalWorkspaceServiceController, type LocalWorkspaceServiceContext } from "./local-workspace-service.controller.ts";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { AgentModule } from "@xue-learn/core/source/libs/server/src/learning-host/agent/agent.module.ts";
import { LocalOutboxModule } from "./local-outbox.module.ts";
import { AgendaModule } from "@xue-learn/core/source/libs/server/src/learning-host/agenda/agenda.module.ts";
import { MemoriesModule } from "@xue-learn/core/source/libs/server/src/learning-host/memories/memories.module.ts";
import { ProfileModule } from "@xue-learn/core/source/libs/server/src/learning-host/profile/profile.module.ts";
import { SettingsModule } from "@xue-learn/core/source/libs/server/src/learning-host/settings/settings.module.ts";
import { TeachingPersonasModule } from "@xue-learn/core/source/libs/server/src/learning-host/teaching-personas/teaching-personas.module.ts";
import { TeachingSkillsModule } from "@xue-learn/core/source/libs/server/src/learning-host/teaching-skills/teaching-skills.module.ts";
import { GenerationModule } from "@xue-learn/core/source/libs/server/src/learning-host/generation/generation.module.ts";
import { GoalsModule } from "@xue-learn/core/source/libs/server/src/learning-host/goals/goals.module.ts";
import { LearningModule } from "@xue-learn/core/source/libs/server/src/learning-host/learning/learning.module.ts";
import { RagModule } from "@xue-learn/core/source/libs/server/src/learning-host/rag/rag.module.ts";
import { FlashcardsModule } from "@xue-learn/core/source/libs/server/src/learning-host/flashcards/flashcards.module.ts";
import { ReviewsModule } from "@xue-learn/core/source/libs/server/src/learning-host/reviews/reviews.module.ts";
import { LlmLogsService } from "@xue-learn/core/source/libs/server/src/learning-host/llm-logs/llm-logs.service.ts";
import { BackendErrorsService } from "@xue-learn/core/source/libs/server/src/learning-host/backend-errors/backend-errors.service.ts";
import {
  LOCAL_HEALTH_CONTEXT,
  LocalHealthController,
  type LocalHealthContext,
} from "./local-health.controller.ts";
import { LocalObservabilityController } from "./local-observability.controller.ts";
import { LocalTeachingSkillsController } from "./local-teaching-skills.controller.ts";
import { LocalAiModelsController } from "./local-ai-models.controller.ts";
import { LocalResourceSettingsController } from "./local-resource-settings.controller.ts";
import { LocalUnitImagesController } from "./local-unit-images.controller.ts";
import { PersonalSyncController } from "./personal-sync/personal-sync.controller.ts";
import { PersonalSyncService } from "@cognilearn/desktop-persistence/personal-sync/personal-sync.service";

/**
 * Desktop-local v2 composition.
 *
 * This is intentionally assembled from the shared learner modules. The old
 * Local* services and kernel are not dependencies of the local runtime. Auth,
 * billing, publication, admin, and hosted MediaModule/PDF are omitted;
 * unit illustration files are served by LocalUnitImagesController. Ingress
 * enforces the same product boundary at HTTP level.
 */
@Module({})
export class DesktopLocalModule {
  static register(healthContext: LocalHealthContext, courseSourceContext?: LocalCourseSourceContext, workspaceServiceContext?: LocalWorkspaceServiceContext, workspaceLearningContext?: WorkspaceLearningPort) {
    return {
      module: DesktopLocalModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        LearningSpacePersistenceModule.register(SqliteLearningSpaceOrmProvider),
        LoggerModule.forRoot({
          pinoHttp: {
            level: process.env.LOG_LEVEL ?? "info",
            autoLogging: false,
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.headers["x-auth-token"]',
              "req.body",
              "res.body",
            ],
          },
        }),
        SettingsModule,
        ProfileModule,
        TeachingPersonasModule,
        TeachingSkillsModule,
        AgendaModule,
        MemoriesModule,
        GoalsModule,
        LearningModule,
        GenerationModule,
        ReviewsModule,
        FlashcardsModule,
        RagModule,
        AgentModule,
        // AnalyticsService switches to an in-process SQLite poller in
        // desktop-local. Goal creation, Deep Research, and later background
        // generation all depend on this durable EventOutbox consumer.
        LocalOutboxModule,
      ],
      controllers: [
        LocalAiModelsController,
        LocalResourceSettingsController,
        LocalUnitImagesController,
        LocalHealthController,
        ...(courseSourceContext ? [LocalCourseSourceController] : []),
        ...(workspaceServiceContext ? [LocalWorkspaceServiceController] : []),
        ...(workspaceLearningContext ? [LocalWorkspaceLearningController] : []),
        LocalObservabilityController,
        LocalTeachingSkillsController,
        PersonalSyncController,
      ],
      providers: [
        { provide: LOCAL_HEALTH_CONTEXT, useValue: healthContext },
        ...(courseSourceContext ? [{ provide: LOCAL_COURSE_SOURCE_CONTEXT, useValue: courseSourceContext }] : []),
        ...(workspaceServiceContext ? [{ provide: LOCAL_WORKSPACE_SERVICE_CONTEXT, useValue: workspaceServiceContext }] : []),
        ...(workspaceLearningContext ? [{provide:LOCAL_WORKSPACE_LEARNING_CONTEXT,useValue:workspaceLearningContext}] : []),
        LlmLogsService,
        BackendErrorsService,
        PersonalSyncService,
      ],
    };
  }
}
