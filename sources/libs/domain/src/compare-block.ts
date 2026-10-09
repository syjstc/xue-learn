import type { InteractiveBlock } from "../../contracts/src/index.js";

export type CompareSide = {
  id?: string;
  label: string;
  points: string[];
};

export function compareSideObjectId(
  side: Pick<CompareSide, "id"> | null | undefined,
  index: number,
): string {
  const authored = typeof side?.id === "string" ? side.id.trim() : "";
  if (authored) return authored;
  if (index === 0) return "left";
  if (index === 1) return "right";
  return `side-${index}`;
}

export type CompareBlock = Extract<InteractiveBlock, { type: "compare" }>;

export function compareBlockSides(block: CompareBlock): CompareSide[] {
  if (block.sides && block.sides.length >= 2) return block.sides;
  return [block.left, block.right];
}

export function buildCompareBlock(
  sides: CompareSide[],
): CompareBlock {
  if (sides.length < 2) {
    throw new Error("compare block needs at least 2 sides");
  }
  const block: CompareBlock = {
    type: "compare",
    left: sides[0]!,
    right: sides[1]!,
  };
  if (sides.length > 2) {
    return {
      ...block,
      sides: [sides[0]!, sides[1]!, ...sides.slice(2)],
    };
  }
  return block;
}

export function compareBlockSideTags(): Array<"CMPL" | "CMPR"> {
  return ["CMPL", "CMPR"];
}

export function compareSideTagForIndex(index: number): "CMPL" | "CMPR" {
  return index % 2 === 0 ? "CMPL" : "CMPR";
}
