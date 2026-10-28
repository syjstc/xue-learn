import type { CSSProperties } from "react";
import {
  materialCalloutDetails,
  type CourseDisplayBlock,
} from "../../../libs/domain/src/index.js";
import { ProseMarkdown } from "../markdown/prose-markdown.js";
import { classroomBoardDisplayText } from "./classroom-stage-typography.js";
import { usePresentationFrame } from "./presentation-stage.js";
import { CourseCalloutFocus } from "./course-callout-focus.js";

/** Explicit detail cues animate the existing Markdown; no narration matching,
 * inferred teaching order, content replacement or additional model call. */
export function CourseCalloutBody(props: {
  figure: CourseDisplayBlock;
  body: string;
  activeTargetIds: readonly string[];
  previousActiveTargetIds: readonly string[];
  revealedTargetIds?: readonly string[];
  previousRevealedTargetIds?: readonly string[];
  clocked: boolean;
  animate: boolean;
  /** Classroom/export reserve every row, including unspoken detail copy. */
  reserveSpace?: boolean;
  progress?: number;
  presentation?: "film";
}) {
  const details = materialCalloutDetails(props.figure);
  const matching = (ids: readonly string[]) =>
    details.flatMap((detail, index) =>
      ids.includes(detail.id) ? [index] : [],
    );
  const selection = (active: readonly string[], history = active) => {
    const all = [...active, ...history].some(
      (id) =>
        id === "whole" ||
        id === "display" ||
        id === `callout-whole:${props.figure.id}`,
    ) || (active.includes(String(props.figure.id)) && !matching(active).length)
      || (history.includes(String(props.figure.id)) && !matching(history).length);
    return all
      ? details.map((_, i) => i)
      : [...new Set([...matching(active), ...matching(history)])];
  };
  const focused = matching(props.activeTargetIds);
  const enabled =
    props.revealedTargetIds !== undefined || focused.length > 0;
  const all = details.map((_, index) => index);
  const frame = usePresentationFrame(
    {
      mode: "steps",
      count: details.length,
      focusedIndexes: focused,
      previousFocusedIndexes: matching(props.previousActiveTargetIds),
      revealedIndexes: !enabled ? all : selection(
        props.activeTargetIds,
        props.revealedTargetIds,
      ),
      previousRevealedIndexes: !enabled ? all : selection(
        props.previousActiveTargetIds,
        props.previousRevealedTargetIds,
      ),
      progress: props.progress,
    },
    props.clocked,
    enabled && props.animate,
  );
  const markdown = (text: string) => (
    <ProseMarkdown
      content={classroomBoardDisplayText(text)}
      variant="board"
      className="lp-semantic-copy"
    />
  );
  if (!details.length || (!enabled && !props.reserveSpace)) return markdown(props.body);
  return (
    <div className="course-callout-details" data-reserved-space={props.reserveSpace || undefined}
      data-focus-travel={props.presentation === "film" && focused.length <= 1 && matching(props.previousActiveTargetIds).length <= 1 || undefined}>
      {props.presentation === "film" && props.reserveSpace && (
        <CourseCalloutFocus layoutKey={props.body} items={frame.items}/>
      )}
      {details.map((detail, index) => {
        const item = frame.items[index]!;
        const reveal = focused.length ? item.reveal : Math.min(1,
          Math.max(0, (item.reveal - index * 0.075) / (1 - index * 0.075)));
        return (
          <div
            key={detail.id}
            className="course-callout-detail"
            data-detail-id={detail.id}
            data-detail-number={String(index + 1).padStart(2, "0")}
            data-active={item.active}
            data-pending={item.pending}
            aria-current={item.active ? "true" : undefined}
            aria-hidden={item.pending || undefined}
            inert={item.pending || undefined}
            style={
              {
                "--detail-rows": `${reveal}fr`,
                "--detail-reveal": reveal,
                "--detail-emphasis": item.emphasis,
              } as CSSProperties
            }
          >
            <div className="course-callout-detail-clip">
              <div className="course-callout-detail-ink">
                {markdown(detail.text)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
