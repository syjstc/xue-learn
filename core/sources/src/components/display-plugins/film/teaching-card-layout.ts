import type {
  TeachingBoardTrack,
  TeachingDerivationStepV1,
} from "../../../../libs/teaching-derivation/src/index.js";

/** One shared set of row boundaries. Incoming rows grow below surviving work;
 * retired rows keep their space until the clock's separate layout phase. */
export function teachingCardLayout(
  tracks: readonly TeachingBoardTrack[],
  previous: Pick<TeachingDerivationStepV1, "board"> | undefined,
  fromStep: number,
  progress: number,
  layoutProgress: number,
) {
  const old =
    previous?.board.filter((f) => f.role === tracks[0]?.formula.role) ?? [];
  let count = old.length;
  const slots = tracks.map((track) => {
    const prior = old.findIndex((f) => f.key === track.formula.key);
    const sourcePrior =
      prior >= 0
        ? prior
        : old.findIndex(
            (f) =>
              (track.source?.stepIndex === fromStep &&
                f.key === track.source.formulaKey) ||
              (track.formula.role === "reference" &&
                track.source &&
                f.source?.stepIndex === track.source.stepIndex &&
                f.source?.formulaKey === track.source.formulaKey),
          );
    return { track, slot: sourcePrior >= 0 ? sourcePrior : count++ };
  });
  const clamp = (p: number) => Math.max(0, Math.min(1, p));
  // Reserve space early, while an entering card is still nearly transparent;
  // otherwise its formula grows from unreadable specks for most of the morph.
  const p = clamp(progress / 0.35);
  const growth = old.length ? p * p * (3 - 2 * p) : 1;
  const layout = clamp(layoutProgress);
  const active = slots
    .filter((s) => s.track.state !== "exit")
    .sort((a, b) => a.slot - b.slot);
  const pitch = 100 / Math.max(1, count);
  const oldPitch = 100 / Math.max(1, old.length);
  const existingHeight = oldPitch + (pitch - oldPitch) * growth;
  const newHeight = pitch * growth;
  return new Map(
    slots.map((item) => {
      const startTop =
        item.slot < old.length
          ? item.slot * existingHeight
          : old.length * existingHeight + (item.slot - old.length) * newHeight;
      const startHeight = item.slot < old.length ? existingHeight : newHeight;
      const index = active.indexOf(item);
      const endHeight = 100 / Math.max(1, active.length);
      return [
        item.track.id,
        {
          top:
            index < 0
              ? startTop
              : startTop + (index * endHeight - startTop) * layout,
          height:
            index < 0
              ? startHeight
              : startHeight + (endHeight - startHeight) * layout,
        },
      ];
    }),
  );
}
