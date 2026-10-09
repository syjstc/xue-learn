import { Injectable, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";
import { LearningOutboxProcessor } from "@xue-learn/core/source/libs/server/src/learning-host/outbox/processor.ts";
import { LearningSpaceOrmProvider } from "@xue-learn/core/source/libs/server/src/learning-spaces/learning-space-orm.provider.ts";
import { ensurePersonalSyncCapture } from "@xue-learn/core/source/libs/server/src/personal-sync/index.ts";
import { processLocalEmbeddingReindexBatch } from "@cognilearn/desktop-persistence/local-embedding-index";
import { recordBackendError } from "@xue-learn/core/source/libs/server/src/observability/index.ts";
import { LOCAL_OWNER_ID } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
@Injectable()
export class LocalOutboxService extends LearningOutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling: Promise<void> | null = null;
  private stopping = false;
  constructor(provider: LearningSpaceOrmProvider) { super(provider); }
  async onModuleInit(): Promise<void> {
    await this.learningSpaceOrm.initialize();
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, 5_000); this.timer.unref?.();
  }
  async onModuleDestroy(): Promise<void> {
    this.stopping = true; if (this.timer) clearInterval(this.timer); await this.polling;
  }
  private poll(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.polling) return this.polling;
    this.polling = this.pollOnce().finally(() => { this.polling = null; }); return this.polling;
  }
  private async pollOnce(): Promise<void> {
    try {
      await ensurePersonalSyncCapture(() => this.processOutboxBatch());
      await processLocalEmbeddingReindexBatch(LOCAL_OWNER_ID);
    } catch (error) {
      this.logger.error(`Local outbox poll failed: ${error instanceof Error ? error.message : String(error)}`);
      await recordBackendError({ source: "worker", service: "desktop-local", error, operation: "event-outbox.poll" }, this.learningSpaceOrm.observability);
    }
  }
}
