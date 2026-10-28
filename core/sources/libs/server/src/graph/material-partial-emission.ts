export const MATERIAL_PARTIAL_HEARTBEAT_MS = 150;

export function shouldEmitMaterialPartialSnapshot(params: {
  now: number;
  lastEmittedAt: number;
  completeBlockCount: number;
  lastCompleteBlockCount: number;
  placeholderBlockCount: number;
  lastPlaceholderBlockCount: number;
}): boolean {
  return (
    params.completeBlockCount !== params.lastCompleteBlockCount ||
    params.placeholderBlockCount !== params.lastPlaceholderBlockCount ||
    params.now - params.lastEmittedAt >= MATERIAL_PARTIAL_HEARTBEAT_MS
  );
}
