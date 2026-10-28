import type { AssistantCourseFeedTurn } from "./assistant-course-feed.ts";
import {
  computeBlockKey,
  resolveBlockIndex,
  type MaterialAnchor,
} from "@xue-learn/core/shared/domain/material-anchor";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";

/** Resolve against the whole feed so unseen discussions never migrate to an earlier paragraph. */
export function courseDiscussionTurn(
  material: LearningMaterialContent,
  turns: AssistantCourseFeedTurn[],
  anchor: MaterialAnchor,
): number | undefined {
  if (anchor.scope === "introduction") {
    const index = turns.findIndex(
      (turn) =>
        turn.kind === "lesson" &&
        turn.narration.some((item) => item.kind === "introduction"),
    );
    return index < 0 ? undefined : index;
  }
  if (anchor.scope === "key_takeaway") {
    const index = turns.findIndex((turn) => turn.kind === "summary");
    return index < 0 ? undefined : index;
  }
  if (
    anchor.blockKey &&
    !material.blocks.some(
      (block, index) => computeBlockKey(block, index) === anchor.blockKey,
    )
  )
    return undefined;
  const blockIndex = resolveBlockIndex(material, anchor);
  if (blockIndex == null) return undefined;
  const index = turns.findIndex(
    (turn) =>
      turn.dividers.some((entry) => entry.blockIndex === blockIndex) ||
      (turn.kind === "lesson" &&
        turn.narration.some(
          (item) => item.kind === "paragraph" && item.blockIndex === blockIndex,
        )) ||
      (turn.kind === "display" && turn.display.blockIndex === blockIndex) ||
      (turn.kind === "key_points" && turn.blockIndex === blockIndex),
  );
  if (index < 0) return undefined;
  if (turns[index].kind !== "display") return index;
  // A display's discussion sits next to its first explanation, within the same topic.
  for (let next = index + 1; next < turns.length; next++) {
    if (turns[next].dividers.some((entry) => entry.block.type === "heading"))
      break;
    if (turns[next].kind !== "display") return next;
  }
  return index;
}
