import { uniqueKeyPointTexts } from "./authoring.js";

export type UnitKeyPointSectionSource = Readonly<{
  id: string;
  title: string;
  orderIndex: number;
  contentKind: string;
  generationStatus: string;
  keyTakeaways: string;
  blocks: string | null;
}>;

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseStoredKeyTakeaways(value: string): string[] {
  return uniqueKeyPointTexts(
    parseJsonArray(value).flatMap((item) =>
      typeof item === "string" ? [item] : [],
    ),
  );
}

export function headingTitlesFromBlocksJson(blocks: string | null): string[] {
  if (!blocks?.trim()) return [];
  return parseJsonArray(blocks).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as { type?: unknown; text?: unknown };
    if (record.type !== "heading") return [];
    const text = typeof record.text === "string" ? record.text.trim() : "";
    return text ? [text] : [];
  });
}

export function isStandardContentSection(
  section: UnitKeyPointSectionSource,
): boolean {
  return (
    section.generationStatus === "ready" &&
    section.contentKind !== "formal_derivation" &&
    Boolean(section.blocks?.trim())
  );
}

export function formatKeyPointCatalog(
  sections: readonly UnitKeyPointSectionSource[],
): string {
  return sections
    .map((section, index) => {
      const topics = headingTitlesFromBlocksJson(section.blocks);
      const topicLines = topics.length
        ? topics.map((title) => `   - ${title}`).join("\n")
        : "   - (no topic headings)";
      return `${index + 1}. ${section.title.trim() || "Untitled"}\n${topicLines}`;
    })
    .join("\n");
}

export function unitNeedsCourseKeyPoints(
  sections: readonly UnitKeyPointSectionSource[],
): boolean {
  const content = sections.filter(isStandardContentSection);
  if (content.length === 0) return false;
  return content.some(
    (section) => parseStoredKeyTakeaways(section.keyTakeaways).length === 0,
  );
}
