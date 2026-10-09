import type { SseEvent } from "../llm/sse.js";
export type RunEventPublisher = (runId: string, event: SseEvent, sequence?: number) => Promise<void>;
let publisher: RunEventPublisher | null = null;
/** Hosted transports may relay durable run events; single-process readers use Core subscribers. */
export function configureRunEventPublisher(value: RunEventPublisher | null): void { publisher = value; }
export async function publishRunEvent(runId: string, event: SseEvent, sequence?: number): Promise<void> {
 if (event.type === "run" || !publisher) return;
 try { await publisher(runId, event, sequence); } catch { /* Durable run rows remain authoritative. */ }
}
