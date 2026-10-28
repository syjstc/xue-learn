import type { SseEvent } from "../../../../contracts/src/index.js";
export type PublishedRunEvent = { event: SseEvent; sequence?: number };
export type GenerationEventHandler = (published: PublishedRunEvent) => void;
/** Event delivery is a host capability; durable state always remains in the run repository. */
export abstract class GenerationEventTransport {
  abstract publish(runId: string, event: SseEvent, sequence?: number): Promise<void>;
  abstract subscribe(runId: string, handler: GenerationEventHandler): Promise<() => Promise<void>>;
}
