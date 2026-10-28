import { isMaterialPresentation, isMaterialStageLayout, materialStageFocusIndexes, materialCalloutDetails } from "../../../libs/domain/src/index.js";
import type { CourseDisplayBlock } from "../../../libs/domain/src/index.js";
/** Only semantic focus facts are shared; hosts may attach their own narration clocks. */
export type CourseFocusBeat = Readonly<{teaching?: Readonly<{targetIds: readonly string[]}>; actions?: readonly Readonly<{id: string; targetId: string}>[]}>;

export function courseBuildBeatTargets(
  beat: CourseFocusBeat,
): readonly string[] {
  return (
    beat.teaching?.targetIds ??
    (beat.actions ?? [])
      .filter(
        (action) => action.id === "highlight" || action.id === "camera_focus",
      )
      .map((action) => action.targetId)
  );
}

export function courseSceneBuildHistory(
  block: CourseDisplayBlock | undefined,
  beats: readonly CourseFocusBeat[],
  beatIndex: number,
): readonly string[] | undefined {
  if (!supportsCourseDetailBuild(block)) return undefined;
  const first = beats.findIndex(
    (beat) => courseBuildBeatTargets(beat).length > 0,
  );
  if (first < 0) return undefined;
  if (beatIndex < first) return [];
  return [
    ...new Set(
      beats.slice(first, beatIndex + 1).flatMap((beat) => {
        const targets = courseBuildBeatTargets(beat);
        return courseBuildHistoryTargets(
          block!,
          targets.length ? targets : ["whole"],
        );
      }),
    ),
  ];
}

export function supportsCourseDetailBuild(
  block: CourseDisplayBlock | undefined,
): boolean {
  return (
    supportsCourseCardBuild(block) ||
    (block?.type === "callout" && materialCalloutDetails(block).length > 0) ||
    (block?.type === "stage" &&
      Array.isArray(block.figures) &&
      block.figures.some((figure) => materialCalloutDetails(figure).length > 0))
  );
}

/** Preserve whole-card visits separately from detail cues' parent lighting ids. */
export function courseBuildHistoryTargets(
  block: CourseDisplayBlock,
  targets: readonly string[],
): readonly string[] {
  const figures =
    block.type === "stage" && Array.isArray(block.figures)
      ? block.figures
      : [block];
  const focused =
    block.type === "stage" ? courseCardRevealedIndexes(block, targets) : [0];
  const wholeCards = focused.flatMap((index) => {
    const figure = figures[index]!;
    const details = materialCalloutDetails(figure);
    return details.length &&
      !details.some((detail) => targets.includes(detail.id))
      ? [`callout-whole:${figure.id}`]
      : [];
  });
  return [...targets, ...wholeCards];
}

/** Automatic builds need explicit narration history; uncued old lessons stay complete. */
export function supportsCourseCardBuild(
  block: CourseDisplayBlock | undefined,
): boolean {
  return (
    block?.type === "stage" &&
    !isMaterialPresentation(block.presentation) &&
    Array.isArray(block.figures) &&
    block.figures.length > 1 &&
    block.figures.length <= 5 &&
    block.figures.every((figure) => figure.type === "callout")
  );
}

export function courseCardRevealedIndexes(
  block: CourseDisplayBlock,
  targets: readonly string[],
): number[] {
  const figures = block.figures as CourseDisplayBlock[];
  const layout = String(block.layout ?? "stack");
  // An overview (including an unresolved cue) must never conceal teaching copy.
  if (targets.includes("whole") || targets.includes("display"))
    return figures.map((_, i) => i);
  const resolved = [
    ...new Set(
      targets.flatMap((target) =>
        materialStageFocusIndexes({
          layout: isMaterialStageLayout(layout) ? layout : "stack",
          figures,
          targetIds: [target],
        }),
      ),
    ),
  ];
  return resolved.length || !targets.length
    ? resolved
    : figures.map((_, i) => i);
}
