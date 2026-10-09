import { randomUUID } from "node:crypto";

/** Stable-looking, collision-safe chunk PK for concurrent scoped ingest. */
export function buildRagChunkId(scopeId: string): string {
  return `${scopeId}_chunk_${randomUUID()}`;
}
