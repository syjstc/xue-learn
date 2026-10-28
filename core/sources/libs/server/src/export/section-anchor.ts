import type { TextbookSection } from "./goal-textbook-model.js";

export function sectionAnchorId(section: TextbookSection): string {
  return `section-${section.index.replace(/\./g, "-")}`;
}
