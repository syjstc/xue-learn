/** Deterministic isomorphic source hash. Shared by Nest and Vite. */
export function hashSource(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let extra = 5381;
  for (let i = 0; i < source.length; i += 1) {
    extra = (extra * 33) ^ source.charCodeAt(i);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}${(extra >>> 0)
    .toString(16)
    .padStart(8, "0")}${source.length.toString(16).padStart(4, "0")}`;
}
