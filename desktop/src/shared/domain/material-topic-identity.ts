import type { InteractiveBlock } from "@xue-learn/core/schemas";

function topicHeadingId(block: InteractiveBlock): string {
  return block.type === "heading" &&
    typeof block.topicId === "string" &&
    block.topicId.trim()
    ? block.topicId.trim()
    : "";
}

export function isTopicHeading(block: InteractiveBlock): boolean {
  return block.type === "heading" && (block.level === 2 || Boolean(topicHeadingId(block)));
}

export function headingTopicIdentity(
  blocks: readonly InteractiveBlock[],
  headingIndex: number,
): { topicId?: string; topicIndex: number } | null {
  const block = blocks[headingIndex];
  if (!block || !isTopicHeading(block)) return null;
  const topicIndex = blocks
    .slice(0, headingIndex)
    .filter((item) => isTopicHeading(item)).length;
  const raw = topicHeadingId(block);
  return {
    topicIndex,
    ...(raw ? { topicId: raw } : {}),
  };
}
