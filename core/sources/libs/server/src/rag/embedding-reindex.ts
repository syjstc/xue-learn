import type {
  LocalEmbeddingIndexRecord,
  LocalEmbeddingReindexSource,
} from "../../../domain/src/index.js";

export type EmbeddingReindexTarget = Readonly<{ provider: string; model: string }>;

/** A host supplies its durable queue, source stores and inference implementation. */
export interface EmbeddingReindexTasks {
  currentTarget(): Promise<EmbeddingReindexTarget>;
  getState(): Promise<LocalEmbeddingIndexRecord | null>;
  queue(target: EmbeddingReindexTarget): Promise<LocalEmbeddingIndexRecord>;
  update(
    target: EmbeddingReindexTarget,
    status: LocalEmbeddingIndexRecord["status"],
    error?: string,
  ): Promise<LocalEmbeddingIndexRecord>;
  listVectors(target: EmbeddingReindexTarget, limit: number): Promise<readonly LocalEmbeddingReindexSource[]>;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  saveVectors(target: EmbeddingReindexTarget, rows: readonly Readonly<{ id: string; vector: readonly number[] }>[]): Promise<void>;
  pendingMemoryCount(target: EmbeddingReindexTarget, limit: number): Promise<number>;
  retryMemory(target: EmbeddingReindexTarget, limit: number): Promise<number>;
  pendingSkillCount(target: EmbeddingReindexTarget, limit: number): Promise<number>;
  retrySkills(target: EmbeddingReindexTarget, limit: number): Promise<Readonly<{ attempted: number; indexed: number }>>;
}

function sameTarget(left: EmbeddingReindexTarget, right: EmbeddingReindexTarget): boolean {
  return left.provider === right.provider && left.model === right.model;
}

async function hasRemainingSources(tasks: EmbeddingReindexTasks, target: EmbeddingReindexTarget): Promise<boolean> {
  const [vectors, memories, skills] = await Promise.all([
    tasks.listVectors(target, 1),
    tasks.pendingMemoryCount(target, 1),
    tasks.pendingSkillCount(target, 1),
  ]);
  return vectors.length > 0 || memories > 0 || skills > 0;
}

/** One bounded pass; the host owns identity scope, transactions and task admission. */
export async function processEmbeddingReindexBatch(
  tasks: EmbeddingReindexTasks,
  batchSize = 8,
): Promise<LocalEmbeddingIndexRecord> {
  const target = await tasks.currentTarget();
  let state = await tasks.getState();
  if (!state || !sameTarget({ provider: state.providerId, model: state.model }, target)) {
    state = await tasks.queue(target);
  }
  if (state.status === "failed") return state;
  if (!(await hasRemainingSources(tasks, target))) {
    return tasks.update(target, "published");
  }
  await tasks.update(target, "building");

  try {
    let budget = Math.max(1, Math.min(500, Math.trunc(batchSize) || 1));
    const sources = await tasks.listVectors(target, budget);
    if (sources.length > 0) {
      const vectors = await tasks.embed(sources.map((source) => source.text));
      const current = await tasks.currentTarget();
      if (!sameTarget(current, target)) return tasks.queue(current);
      await tasks.saveVectors(target, sources.map((source, index) => ({
        id: source.id,
        vector: vectors[index] ?? [],
      })));
      budget -= sources.length;
    }
    if (budget > 0) {
      const count = await tasks.pendingMemoryCount(target, budget);
      const indexed = await tasks.retryMemory(target, count);
      if (indexed !== count) throw new Error("One or more general-memory records could not be embedded");
      budget -= indexed;
    }
    if (budget > 0) {
      const result = await tasks.retrySkills(target, budget);
      if (result.indexed !== result.attempted) throw new Error("One or more teaching skills could not be embedded");
    }

    const current = await tasks.currentTarget();
    if (!sameTarget(current, target)) return tasks.queue(current);
    // Include sources accepted while inference was running before publishing.
    return tasks.update(target, await hasRemainingSources(tasks, target) ? "building" : "published");
  } catch (error) {
    return tasks.update(target, "failed", error instanceof Error ? error.message : "Embedding reindex failed");
  }
}
