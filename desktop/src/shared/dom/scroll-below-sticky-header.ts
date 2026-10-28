/** Offset for sticky app headers (PublicNav h-12 + gap, goal unit bar h-14 + gap). */
export const STICKY_SCROLL_OFFSET_PX = 64;

export function scrollIntoViewBelowStickyHeader(
  element: Element | null | undefined,
  options: { behavior?: ScrollBehavior; offsetPx?: number } = {},
): void {
  if (!element) return;

  const { behavior = "smooth", offsetPx = STICKY_SCROLL_OFFSET_PX } = options;
  const top =
    element.getBoundingClientRect().top + window.scrollY - offsetPx;

  window.scrollTo({ top: Math.max(0, top), behavior });
}
