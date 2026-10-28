/** Stable dense-vector encoding shared by storage adapters, without a database driver. */
export function encodeEmbeddingVector(vector: readonly number[]): string {
 if (!vector.every(value => typeof value === "number" && Number.isFinite(value))) throw new Error("Embedding vectors must contain finite numbers");
 return JSON.stringify(vector);
}
