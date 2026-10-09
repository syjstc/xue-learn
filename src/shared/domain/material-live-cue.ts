import {
  precedingDisplayIndex,
  comboDisplayCueTargetIds,
  resolveParagraphCue,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";

export function paragraphCueTargetIds(
  blocks: readonly InteractiveBlock[],
  paragraphIndex: number,
): readonly string[] {
  const paragraph = blocks[paragraphIndex];
  if (!paragraph || paragraph.type !== "paragraph") return [];
  const displayIndex = precedingDisplayIndex(blocks, paragraphIndex);
  const display = displayIndex == null ? undefined : blocks[displayIndex];
  const cue =
    "cue" in paragraph ? (paragraph as { cue?: unknown }).cue : undefined;
  return resolveParagraphCue(display, cue)?.targetIds ?? [];
}

export function comboCueTargetIds(
  blocks: readonly InteractiveBlock[],
  displayIndex: number,
): readonly string[] {
  return comboDisplayCueTargetIds(blocks, displayIndex);
}
