export type MemoryLayer = "working" | "episodic" | "semantic" | "procedural";

export type MemoryChunk = {
  layer: MemoryLayer;
  key: string;
  content: string;
  source?: string;
  createdAt?: string;
};

export interface AgentMemoryStore {
  getWorkingContext(threadId: string): Promise<MemoryChunk[]>;
  getRelevantFacts(userId: string, query: string): Promise<MemoryChunk[]>;
  recordEpisode(threadId: string, summary: string): Promise<void>;
  getProceduralDefaults(userId: string): Promise<Record<string, unknown>>;
}
