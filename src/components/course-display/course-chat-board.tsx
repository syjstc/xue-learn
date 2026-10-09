import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  compareBlockSides,
  type CourseDisplayBlock,
} from "@xue-learn/core/domain";
import type { InteractiveBlock } from "@xue-learn/core/schemas";
import { CourseBoardContent } from "@xue-learn/core/display/course-board-content";
import { useBoardFocusVisibility } from "./use-board-focus-visibility.ts";

export type CourseBoardPlayback = { key: string; animate: boolean; revealedTargetIds?: readonly string[] };

export function supportsCourseChatBoard(block: InteractiveBlock): boolean {
  if (block.type === "stage")
    return block.figures.every(
      (figure) =>
        supportsCourseChatBoard(figure) ||
        figure.type === "svg" ||
        figure.type === "illustration",
    );
  return ["music", "visual", "teaching", "compare", "callout", "code", "conversation"].includes(
    block.type,
  );
}

/** Browser transitions retarget from the currently painted state, including
 * an interrupted reverse transition. Message identity is not an animation key. */
function useMessageBoardMotion(playback?: CourseBoardPlayback) {
  const [enabled, setEnabled] = useState(false);
  useLayoutEffect(() => {
    if (playback?.animate) setEnabled(true);
  }, [playback?.animate]);
  return enabled;
}

export function CourseChatBoard({
  block,
  activeTargetIds,
  playback,
  renderCode,
  renderMedia,
}: {
  block: InteractiveBlock;
  activeTargetIds: readonly string[];
  playback?: CourseBoardPlayback;
  renderCode: (
    block: CourseDisplayBlock,
    options?: { contentSized: boolean },
  ) => ReactNode;
  renderMedia: (block: CourseDisplayBlock) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useBoardFocusVisibility(rootRef, activeTargetIds.join("\n"));
  const [contentSize, setContentSize] = useState({ width: 700, height: 400 });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const width = Math.round(root.clientWidth),
        height = Math.round(root.clientHeight);
      setContentSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const motionEnabled = useMessageBoardMotion(playback);
  let templateId = "content.teacher_board";
  let slots: Record<string, string> = {};
  if (block.type === "compare") {
    const sides = compareBlockSides(block);
    templateId = "content.compare";
    slots = {
      leftLabel: sides[0]?.label ?? "",
      left: sides[0]?.points.join(" · ") ?? "",
      rightLabel: sides[1]?.label ?? "",
      right: sides[1]?.points.join(" · ") ?? "",
    };
  } else if (block.type === "stage") {
    templateId = "content.stage";
  } else if (block.type === "callout") {
    templateId = "content.focus";
    slots = { heading: block.title ?? "", callout: block.body };
  } else if (block.type === "visual" || block.type === "music" || block.type === "teaching") {
    templateId = "content.media";
    slots = { mediaKind: block.type };
  } else if (block.type === "code") {
    templateId = "content.media";
    slots = { mediaKind: "code" };
  } else if (block.type === "conversation") {
    templateId = "content.conversation";
    slots = { title: block.title ?? "" };
  }
  return (
    <div
      ref={rootRef}
      className="course-display-board"
      data-board-type={block.type}
      data-board-playback={playback?.key}
      data-board-motion={motionEnabled ? "smooth" : undefined}
      data-lp-cued={activeTargetIds.length ? "true" : undefined}
      data-lp-whole={activeTargetIds.includes("whole") ? "true" : undefined}
      style={{
        ["--lp-beat-enter" as string]: 1,
        ["--lp-action-highlight" as string]: 0,
      }}
    >
      <CourseBoardContent
        mode="chat"
        animate={motionEnabled}
        contentSize={contentSize}
        scene={{ templateId, slots, title: "" }}
        mediaBlock={block as unknown as CourseDisplayBlock}
        activeTargetIds={activeTargetIds}
        previousActiveTargetIds={activeTargetIds}
        revealedTargetIds={playback?.revealedTargetIds}
        clocked
        beatEnter={1}
        renderCode={renderCode}
        renderMedia={renderMedia}
      />
    </div>
  );
}
