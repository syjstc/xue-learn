/** Shared learning applications; database and process lifecycle belong to hosts. */
export * from "./browser.js";
export {LearningSpaceOrmProvider} from "../../libs/server/src/learning-spaces/learning-space-orm.provider.js";
export {LearningSpacePersistenceModule} from "../../libs/server/src/learning-spaces/learning-space-persistence.module.js";
export {GoalsModule} from "../../libs/server/src/learning-host/goals/goals.module.js";
export {LearningModule} from "../../libs/server/src/learning-host/learning/learning.module.js";
export {GenerationModule} from "../../libs/server/src/learning-host/generation/generation.module.js";
export {ReviewsModule} from "../../libs/server/src/learning-host/reviews/reviews.module.js";
export {FlashcardsModule} from "../../libs/server/src/learning-host/flashcards/flashcards.module.js";
export {RagModule} from "../../libs/server/src/learning-host/rag/rag.module.js";
export {AgentModule} from "../../libs/server/src/learning-host/agent/agent.module.js";
export {runGenerationContextScope, getActiveGenerationContextScope} from "../../libs/server/src/generation/kernel.js";

export {MemoriesModule} from "../../libs/server/src/learning-host/memories/memories.module.js";
export {ProfileModule} from "../../libs/server/src/learning-host/profile/profile.module.js";
export {SettingsModule} from "../../libs/server/src/learning-host/settings/settings.module.js";
export {TeachingPersonasModule} from "../../libs/server/src/learning-host/teaching-personas/teaching-personas.module.js";
export {TeachingSkillsModule} from "../../libs/server/src/learning-host/teaching-skills/teaching-skills.module.js";
export {LlmLogsService} from "../../libs/server/src/learning-host/llm-logs/llm-logs.service.js";
export {BackendErrorsService} from "../../libs/server/src/learning-host/backend-errors/backend-errors.service.js";
export * as Outbox from "../../libs/server/src/learning-host/outbox/processor.js";

export * as LearningSpacePorts from "../../libs/server/src/learning-spaces/orm-runtime-adapter.js";
export * as TextbookPdf from "../../libs/server/src/export/render-goal-textbook-pdf.js";
export * as Reading from "../../libs/server/src/reading.js";
export * as TextbookData from "../../libs/server/src/export/goal-textbook-persistence.js";
export * as FormalDerivationEvents from "../../libs/server/src/formal-derivation/run-events.js";
export {migrateUnitLabDefinition} from "../../libs/server/src/unit-lab/migrate.js";

export {processEmbeddingReindexBatch, type EmbeddingReindexTasks, type EmbeddingReindexTarget} from "../../libs/server/src/rag/embedding-reindex.js";
