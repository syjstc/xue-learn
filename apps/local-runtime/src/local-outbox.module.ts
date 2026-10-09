import { Module } from "@nestjs/common";
import { LearningSpacePersistenceModule } from "@xue-learn/core/source/libs/server/src/learning-spaces/learning-space-persistence.module.ts";
import { LocalOutboxService } from "./local-outbox.service.ts";
@Module({ imports: [LearningSpacePersistenceModule], providers: [LocalOutboxService] })
export class LocalOutboxModule {}
