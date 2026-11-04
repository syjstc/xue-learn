export type LearningStreamMessage = {data: string; type: string; lastEventId: string};
export function consumeEventStream(response: Response, onMessage: (message: LearningStreamMessage) => void, signal?: AbortSignal, initialEventId?: string): Promise<void>;
export class AuthenticatedEventSource {
  constructor(path: string, options: {fetch: (path: string, init: RequestInit) => Promise<Response>; retryMs?: number});
  onmessage: ((message: LearningStreamMessage) => void) | null;
  onerror: ((error: unknown) => void) | null;
  close(): void;
}
