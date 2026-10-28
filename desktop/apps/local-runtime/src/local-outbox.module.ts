import { Module } from "@nestjs/common";
import { LearningSpacePersistenceModule } from "@xue-learn/core/server/learning-spaces/learning-space-persistence.module";
import { LocalOutboxService } from "./local-outbox.service.ts";
@Module({ imports: [LearningSpacePersistenceModule], providers: [LocalOutboxService] })
export class LocalOutboxModule {}
