export type MeteredLlmKind = "chat" | "embedding" | "image" | "audio";
export type LlmUsageAccountingPort = Readonly<{
 beforeRequest(userId: string | undefined, provider: string, model: string, kind: MeteredLlmKind): Promise<void>;
 afterRequest(logId: string): Promise<void>;
}>;
let accounting: LlmUsageAccountingPort | null = null;
/** A host owns accounting. Core retains all request logs and token attribution independently. */
export function configureLlmUsageAccounting(value: LlmUsageAccountingPort | null): void { accounting = value; }
export function isMeteredLlmKind(kind: string): kind is MeteredLlmKind { return ["chat", "embedding", "image", "audio"].includes(kind); }
export async function beforeMeteredLlmRequest(userId: string | undefined, provider: string, model: string, kind: MeteredLlmKind): Promise<void> { await accounting?.beforeRequest(userId, provider, model, kind); }
export async function afterMeteredLlmRequest(logId: string): Promise<void> { await accounting?.afterRequest(logId); }
