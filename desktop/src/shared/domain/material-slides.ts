import type { InteractiveBlock, LearningMaterialContent } from "@xue-learn/core/schemas";

function normalizedKeyPointText(text: string): string {
  return text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function uniqueKeyPointTexts(points: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const point of points) {
    const trimmed = point.trim();
    if (!trimmed) continue;
    const key = normalizedKeyPointText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

const MARKDOWN_LIST_ITEM = /^(?:[-*+•▪◦]\s+|\d+[.)、]\s*)(.+)$/;

function markdownListItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(MARKDOWN_LIST_ITEM);
      return match?.[1]?.trim() ? [match[1].trim()] : [];
    });
}

function paragraphListItems(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const listItems = markdownListItems(text);
  return listItems.length >= 2 && listItems.length / lines.length >= 0.6
    ? listItems
    : [];
}

function uniqueParagraphListItems(text: string): string {
  const items = paragraphListItems(text);
  if (items.length < 2) return text;
  const unique = uniqueKeyPointTexts(items);
  if (unique.length === items.length) return text;
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => MARKDOWN_LIST_ITEM.test(line));
  const prefix = firstLine?.match(/^(?:[-*+•▪◦]\s+|\d+[.)、]\s*)/)?.[0] ?? "- ";
  return unique.map((item) => `${prefix}${item}`).join("\n");
}

function uniqueMaterialKeyPointLists(
  material: LearningMaterialContent,
): LearningMaterialContent {
  const blocks = material.blocks.map((block) =>
    block.type === "paragraph"
      ? { ...block, text: uniqueParagraphListItems(block.text) }
      : block,
  );
  const keyTakeaways = uniqueKeyPointTexts(material.keyTakeaways);
  const last = blocks.at(-1);
  const covered =
    last?.type === "paragraph" &&
    keyTakeaways.length > 0 &&
    keyTakeaways.every((point) =>
      uniqueKeyPointTexts(markdownListItems(last.text)).some(
        (item) => normalizedKeyPointText(item) === normalizedKeyPointText(point),
      ),
    );
  return {
    ...material,
    blocks,
    keyTakeaways: covered ? [] : keyTakeaways,
  };
}

function sectionTakeawayListParagraph(items: string[]): InteractiveBlock {
  return {
    type: "paragraph",
    text: items.map((item) => `- ${item}`).join("\n"),
  };
}

/** Move keyTakeaways into a lone H2 section when K lines were parsed globally. */
export function repairHeadingOnlySectionTakeaways(
  material: LearningMaterialContent,
): LearningMaterialContent {
  const blocks = Array.isArray(material.blocks) ? material.blocks : [];
  const keyTakeaways = Array.isArray(material.keyTakeaways)
    ? material.keyTakeaways
    : [];
  const normalized = uniqueMaterialKeyPointLists(
    blocks === material.blocks && keyTakeaways === material.keyTakeaways
      ? material
      : { ...material, blocks, keyTakeaways },
  );
  const sections = splitBlocksIntoSections(normalized.blocks);
  const headingOnlySections = sections.filter((section) =>
    section.blockIndices.every((blockIndex) => {
      const block = normalized.blocks[blockIndex];
      return block?.type === "heading" && block.level === 2;
    }),
  );
  if (headingOnlySections.length !== 1 || normalized.keyTakeaways.length === 0) {
    return normalized;
  }

  return uniqueMaterialKeyPointLists({
    ...normalized,
    blocks: [
      ...normalized.blocks,
      sectionTakeawayListParagraph(normalized.keyTakeaways),
    ],
    keyTakeaways: [],
  });
}

export type MaterialSectionSlide = {
  kind: "section";
  title: string;
  blockIndices: number[];
  sectionIndex: number;
};

export type MaterialSlide =
  | { kind: "intro"; text: string }
  | MaterialSectionSlide
  | { kind: "takeaways"; items: string[] };

export type MaterialSlideTocEntry = {
  slideIndex: number;
  label: string;
  kind: MaterialSlide["kind"];
};

export function splitBlocksIntoSections(
  blocks: InteractiveBlock[]
): Array<{ title: string; blockIndices: number[] }> {
  const sections: Array<{ title: string; blockIndices: number[] }> = [];
  let current: { title: string; blockIndices: number[] } | null = null;

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    if (block.type === "heading" && block.level === 2) {
      if (current && current.blockIndices.length > 0) {
        sections.push(current);
      }
      current = { title: block.text, blockIndices: [blockIndex] };
      continue;
    }

    if (!current) {
      current = { title: "开篇", blockIndices: [] };
    }
    current.blockIndices.push(blockIndex);
  }

  if (current && current.blockIndices.length > 0) {
    sections.push(current);
  }

  return sections;
}

export function buildMaterialSlides(
  material: LearningMaterialContent
): MaterialSlide[] {
  const repaired = repairHeadingOnlySectionTakeaways(material);
  const slides: MaterialSlide[] = [];

  const intro = repaired.introduction.trim();
  if (intro) {
    slides.push({ kind: "intro", text: intro });
  }

  const sections = splitBlocksIntoSections(repaired.blocks);
  sections.forEach((section, sectionIndex) => {
    slides.push({
      kind: "section",
      title: section.title,
      blockIndices: section.blockIndices,
      sectionIndex,
    });
  });

  return slides;
}

export function buildMaterialSlideToc(
  slides: MaterialSlide[]
): MaterialSlideTocEntry[] {
  return slides.map((slide, slideIndex) => ({
    slideIndex,
    label: slideLabel(slide, slideIndex),
    kind: slide.kind,
  }));
}

export function slideLabel(slide: MaterialSlide, index: number): string {
  if (slide.kind === "intro") return "导言";
  if (slide.kind === "takeaways") return "核心要点";
  return slide.title || `第 ${index + 1} 节`;
}

export function sectionCheckBlockIndices(
  material: LearningMaterialContent,
  slide: MaterialSectionSlide
): number[] {
  return slide.blockIndices.filter(
    (blockIndex) => material.blocks[blockIndex]?.type === "check"
  );
}
