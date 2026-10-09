export type AssistantCourseScrollGeometry = {
  scrollY: number;
  viewportHeight: number;
  documentHeight: number;
  turnTop: number;
  turnBottom: number;
  topInset: number;
  bottomInset?: number;
};

/**
 * Keep a newly revealed course turn readable without treating the page like a
 * chat transcript that must always be pinned to its bottom.
 *
 * The caller decides whether the reveal was user initiated. The geometry uses
 * viewport-relative turn coordinates and returns an absolute document scroll
 * position. It never scrolls upward: revealing new content should not pull a
 * learner away from text they intentionally revisited.
 */
export function resolveAssistantCourseScrollTop({
  scrollY,
  viewportHeight,
  documentHeight,
  turnTop,
  turnBottom,
  topInset,
  bottomInset = 24,
}: AssistantCourseScrollGeometry): number {
  const maxScrollY = Math.max(0, documentHeight - viewportHeight);
  const viewportBottom = viewportHeight - bottomInset;
  const availableHeight = Math.max(0, viewportBottom - topInset);
  const turnHeight = Math.max(0, turnBottom - turnTop);
  const readableStartLimit = Math.max(
    topInset,
    Math.min(viewportHeight * 0.42, viewportBottom - 96),
  );

  let delta = 0;
  if (turnTop > readableStartLimit || turnHeight > availableHeight) {
    delta = turnTop - topInset;
  } else if (turnBottom > viewportBottom) {
    delta = turnBottom - viewportBottom;
  }

  return Math.min(maxScrollY, Math.max(scrollY, scrollY + Math.max(0, delta)));
}

/**
 * Continue reveals the next block like a chat transcript: pin the newly
 * appeared turn to the bottom of the reading viewport (above sticky controls).
 * Never scrolls upward.
 */
export function resolveAssistantCourseContinueScrollTop({
  scrollY,
  viewportHeight,
  documentHeight,
  turnBottom,
  bottomInset = 24,
}: Pick<
  AssistantCourseScrollGeometry,
  "scrollY" | "viewportHeight" | "documentHeight" | "turnBottom"
> & { bottomInset?: number }): number {
  const maxScrollY = Math.max(0, documentHeight - viewportHeight);
  const viewportBottom = viewportHeight - bottomInset;
  const delta = Math.max(0, turnBottom - viewportBottom);
  return Math.min(maxScrollY, Math.max(scrollY, scrollY + delta));
}
