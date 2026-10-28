import { materialStageMotionEase } from "./material-stage-layout.js";

/** Small semantic choice; geometry and choreography are entirely client-owned. */
export const MATERIAL_PRESENTATIONS = ["steps", "compare", "focus"] as const;
export type MaterialPresentation = (typeof MATERIAL_PRESENTATIONS)[number];
export function isMaterialPresentation(
  value: unknown,
): value is MaterialPresentation {
  return MATERIAL_PRESENTATIONS.includes(value as MaterialPresentation);
}
const validIndexes = (indexes: readonly number[], count: number) =>
  [...new Set(indexes)].filter(
    (index) => Number.isInteger(index) && index >= 0 && index < count,
  );

/** Pure sampling makes reverse seeks, resumed playback and HTML export agree.
 * No/unknown/whole cues show the complete board; they never hide teaching copy. */
export function materialPresentationFrame(input: {
  mode: MaterialPresentation;
  count: number;
  focusedIndexes: readonly number[];
  previousFocusedIndexes?: readonly number[];
  progress?: number;
  /** VideoTick already supplies an eased beat; do not ease it a second time. */
  progressEased?: boolean;
  reducedMotion?: boolean;
  /** Cursor-derived history for ordinary card builds, including non-linear cues. */
  revealedIndexes?: readonly number[];
  previousRevealedIndexes?: readonly number[];
}) {
  const count = Math.max(0, Math.min(5, Math.floor(input.count)));
  const focused = validIndexes(input.focusedIndexes, count);
  const previous = validIndexes(input.previousFocusedIndexes ?? focused, count);
  const revealed = input.revealedIndexes && validIndexes(input.revealedIndexes, count);
  const previouslyRevealed = input.previousRevealedIndexes
    ? validIndexes(input.previousRevealedIndexes, count)
    : revealed;
  const unchanged = focused.join(",") === previous.join(",") &&
    revealed?.join(",") === previouslyRevealed?.join(",");
  const raw = input.progress ?? 1;
  const progress =
    input.reducedMotion || unchanged
      ? 1
      : input.progressEased
        ? Math.min(1, Math.max(0, Number.isFinite(raw) ? raw : 1))
        : materialStageMotionEase(Number.isFinite(raw) ? raw : 1);
  const state = (index: number, selection: number[], visible?: number[]) => {
    const overview = !selection.length || selection.length === count;
    const active = selection.includes(index);
    const revealed = input.mode !== "steps" || (visible
      ? visible.includes(index)
      : overview || index <= Math.max(...selection));
    return {
      reveal: revealed ? 1 : 0,
      emphasis: active && !overview ? 1 : 0,
      opacity: overview || active ? 1 : revealed ? 0.68 : 1,
      weight: input.mode === "focus" && !overview ? (active ? 1.4 : 1) : 1,
    };
  };
  const mix = (a: number, b: number) => a + (b - a) * progress;
  return {
    overview: !focused.length || focused.length === count,
    items: Array.from({ length: count }, (_, index) => {
      const from = state(index, previous, previouslyRevealed),
        to = state(index, focused, revealed);
      return {
        index,
        active: focused.includes(index),
        pending: to.reveal === 0,
        reveal: mix(from.reveal, to.reveal),
        emphasis: mix(from.emphasis, to.emphasis),
        opacity: mix(from.opacity, to.opacity),
        weight: mix(from.weight, to.weight),
      };
    }),
  };
}
