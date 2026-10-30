import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import { resolveParagraphCue } from "@xue-learn/core/domain";
import {
  supportsCourseDetailBuild,
  courseBuildHistoryTargets,
} from "@xue-learn/core/shared/domain/course-card-build";
import type {
  AssistantCourseFeedBlock,
  AssistantCourseFeedTurn,
} from "./assistant-course-feed.ts";

/** A projection over the original feed: cursor indices and stored text never change. */
export function resolveAssistantCourseDisplay(
  material: LearningMaterialContent,
  turns: readonly AssistantCourseFeedTurn[],
  firstTurn: number,
  visibleCount: number,
) {
  const end = Math.max(0, Math.min(turns.length, visibleCount));
  const start = Math.max(0, Math.min(firstTurn, end));
  let displays: Array<{ entry: AssistantCourseFeedBlock; turnIndex: number }> =
    [];
  let current: (typeof displays)[number] | undefined;
  let targets: readonly string[] = [];
  let timelineCueId: string | undefined;
  const assignments = new Map<number, string>();
  let textStart = start;
  let currentKey = `text:${start}`;
  let topicStart = start;
  const revealed = new Map<number, Set<string>>();
  for (let index = start; index < end; index++) {
    const turn = turns[index]!;
    if (turn.dividers.some((entry) => entry.block.type === "heading")) {
      displays = [];
      current = undefined;
      topicStart = index;
      textStart = index;
    }
    targets = [];
    timelineCueId = undefined;
    if (turn.kind === "display") {
      current = { entry: turn.display, turnIndex: index };
      displays.push(current);
      if (supportsCourseDetailBuild(current.entry.block)) {
        // Look ahead only to establish whether builds are available. Never
        // reveal a future cue before the learner reaches its narration turn.
        let hasNarration = false;
        for (let next = index + 1; next < turns.length; next++) {
          const following = turns[next]!;
          if (
            following.kind !== "lesson" ||
            following.dividers.some((entry) => entry.block.type === "heading")
          )
            break;
          const paragraph = following.narration.find(
            (item) => item.kind === "paragraph",
          );
          if (!paragraph) continue;
          const block = material.blocks[paragraph.blockIndex];
          const cue = block && "cue" in block ? block.cue : undefined;
          hasNarration = Boolean(resolveParagraphCue(current.entry.block, cue));
          break;
        }
        if (hasNarration) revealed.set(current.entry.blockIndex, new Set());
      }
    } else if (turn.kind === "lesson") {
      for (const item of turn.narration) {
        if (item.kind !== "paragraph") continue;
        const paragraph = material.blocks[item.blockIndex];
        const cue = paragraph && "cue" in paragraph ? paragraph.cue : undefined;
        // Only already encountered displays in this topic may be referenced.
        const matches = [...displays].reverse().flatMap((display) => {
          const resolved = resolveParagraphCue(display.entry.block, cue);
          return resolved ? [{ display, resolved }] : [];
        });
        if (matches.length) {
          current = matches[0]!.display;
          targets = matches[0]!.resolved.targetIds;
          timelineCueId = cue && typeof cue === "object" && "timelineCueId" in cue && typeof cue.timelineCueId === "string"
            ? cue.timelineCueId
            : undefined;
        } else {
          current = displays.at(-1);
        }
        if (current && supportsCourseDetailBuild(current.entry.block)) {
          const seen =
            revealed.get(current.entry.blockIndex) ?? new Set<string>();
          for (const target of courseBuildHistoryTargets(
            current.entry.block,
            targets.length ? targets : ["whole"],
          ))
            seen.add(target);
          revealed.set(current.entry.blockIndex, seen);
        }
      }
    } else {
      current = undefined;
      textStart = index;
    }
    currentKey = current
      ? `display:${current.entry.blockIndex}`
      : `text:${textStart}`;
    assignments.set(index, currentKey);
  }
  const narrationTurnIndices = Array.from(assignments.keys()).filter(
    (index) =>
      index >= topicStart &&
      assignments.get(index) === currentKey &&
      turns[index]?.kind !== "display",
  );
  return {
    key: currentKey,
    display: current?.entry,
    displayTurnIndex: current?.turnIndex,
    narrationTurnIndices,
    displayGroups: displays.map((display) => ({
      key: `display:${display.entry.blockIndex}`,
      entry: display.entry,
      turnIndex: display.turnIndex,
      narrationTurnIndices: Array.from(assignments.keys()).filter(
        (index) =>
          index >= topicStart &&
          assignments.get(index) === `display:${display.entry.blockIndex}` &&
          turns[index]?.kind !== "display",
      ),
    })),
    activeTargetIds: targets,
    timelineCueId,
    revealedTargetIdsByBlock: Object.fromEntries(
      [...revealed].map(([index, ids]) => [index, [...ids]]),
    ),
    topicStart,
    cursor: end,
  };
}
