import type {ReactNode} from "react";
import type {CourseDisplayBlock} from "@xue-learn/core/domain";
import type {InteractiveBlock} from "@xue-learn/core/schemas";
import {DisplayBlockHost} from "@/features/display/display-block-host";

export type CourseBoardPlayback = {key: string; animate: boolean; cueId?: string; revealedTargetIds?: readonly string[]};

export function supportsCourseChatBoard(block: InteractiveBlock): boolean {
  return ["display", "stage", "music", "visual", "teaching", "compare", "callout", "code", "illustration", "svg", "conversation"].includes(block.type);
}

/** Learning chrome owns cue selection; the same plugin artwork is used in video. */
export function CourseChatBoard({block, activeTargetIds, playback}: {
  block: InteractiveBlock;
  activeTargetIds: readonly string[];
  playback?: CourseBoardPlayback;
  renderCode: (block: CourseDisplayBlock, options?: {contentSized: boolean}) => ReactNode;
  renderMedia: (block: CourseDisplayBlock) => ReactNode;
}) {
  return <div className="course-display-board" data-board-type={block.type} data-board-playback={playback?.key}>
    <DisplayBlockHost block={block} activeTargetIds={activeTargetIds} playback={playback}/>
  </div>;
}
