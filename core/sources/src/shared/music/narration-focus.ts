import { musicStepTarget } from "../../../libs/domain/src/index.js";

/** Exact, host-authored target membership only. Progress is already sampled
 * from the speech clock; repeated targets retain a steady light at any tick. */
export function sampleMusicNarrationFocus(input: {
  figureId: string;
  targetId: string;
  targetIds: readonly string[];
  previousTargetIds?: readonly string[];
  progress?: number;
}): number {
  const selected = (ids: readonly string[]) =>
    !ids.some(id => id === "whole" || id === "display" || id === input.figureId)
    && (ids.includes(input.targetId) || ids.includes(musicStepTarget(input.figureId, input.targetId)));
  const to = selected(input.targetIds) ? 1 : 0;
  const from = selected(input.previousTargetIds ?? input.targetIds) ? 1 : 0;
  const progress = Math.max(0, Math.min(1, input.progress ?? 1));
  return from + (to - from) * progress;
}
