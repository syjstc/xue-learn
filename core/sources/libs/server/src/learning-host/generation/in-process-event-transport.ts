import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { SseEvent } from "../../../../contracts/src/index.js";
import { GenerationEventTransport, type GenerationEventHandler } from "./event-transport.js";
@Injectable()
export class InProcessGenerationEventTransport extends GenerationEventTransport implements OnModuleDestroy {
  private readonly handlers = new Map<string, Set<GenerationEventHandler>>();
  async publish(runId: string, event: SseEvent, sequence?: number): Promise<void> {
    for (const handler of [...(this.handlers.get(runId) ?? [])]) handler({ event, sequence });
  }
  async subscribe(runId: string, handler: GenerationEventHandler): Promise<() => Promise<void>> {
    const handlers = this.handlers.get(runId) ?? new Set<GenerationEventHandler>();
    handlers.add(handler); this.handlers.set(runId, handlers);
    return async () => { handlers.delete(handler); if (!handlers.size && this.handlers.get(runId) === handlers) this.handlers.delete(runId); };
  }
  onModuleDestroy(): void { this.handlers.clear(); }
}
