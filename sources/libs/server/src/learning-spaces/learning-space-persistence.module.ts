import { Global, Module, type Type } from "@nestjs/common";
import { LearningSpaceOrmProvider } from "./learning-space-orm.provider.js";
@Global()
@Module({})
export class LearningSpacePersistenceModule {
 static register(adapter: Type<LearningSpaceOrmProvider>) {
  return { module: LearningSpacePersistenceModule, providers: [{ provide: LearningSpaceOrmProvider, useClass: adapter }], exports: [LearningSpaceOrmProvider] };
 }
}
