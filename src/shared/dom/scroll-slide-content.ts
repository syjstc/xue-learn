import { scrollIntoViewBelowStickyHeader } from "@/shared/dom/scroll-below-sticky-header";

export const SLIDE_SCROLL_SELECTOR = "[data-slide-scroll]";

/** Reset inner slide scroll regions before paging. */
export function resetSlideInnerScroll(
  card: Element | null | undefined,
): void {
  if (!card) return;
  if (card instanceof HTMLElement && card.hasAttribute("data-slide-scroll")) {
    card.scrollTop = 0;
  }
  card.querySelectorAll<HTMLElement>(SLIDE_SCROLL_SELECTOR).forEach((el) => {
    el.scrollTop = 0;
  });
}

/** Scroll the page (and reset inner slide scroll) when moving between slides. */
export function scrollSlideContentToTop(
  card: Element | null | undefined,
  contentTop: Element | null | undefined,
  options: { behavior?: ScrollBehavior; offsetPx?: number } = {},
): void {
  if (!card && !contentTop) return;
  resetSlideInnerScroll(card);
  scrollIntoViewBelowStickyHeader(contentTop ?? card, options);
}
