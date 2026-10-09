import { Controller, Get, Inject } from "@nestjs/common";
import {
  LOCAL_OWNER_ID,
  type RuntimeDescriptor,
} from "@xue-learn/core/runtime-contracts";
import { LearningSpaceOrmProvider } from "@xue-learn/core/server/learning-spaces/learning-space-orm.provider";

export type LocalHealthContext = Readonly<{
  instanceId: string;
  startedAt: number;
  descriptor: RuntimeDescriptor;
}>;

export const LOCAL_HEALTH_CONTEXT = Symbol("LOCAL_HEALTH_CONTEXT");

@Controller("api/local/health")
export class LocalHealthController {
  constructor(
    private readonly persistence: LearningSpaceOrmProvider,
    @Inject(LOCAL_HEALTH_CONTEXT)
    private readonly context: LocalHealthContext,
  ) {}

  @Get()
  async getHealth() {
    await this.persistence.checkConnection();
    return {
      status: "ready" as const,
      schemaVersion: 1 as const,
      instanceId: this.context.instanceId,
      ownerId: LOCAL_OWNER_ID,
      runtime: this.context.descriptor,
      startedAt: this.context.startedAt,
    };
  }
}
