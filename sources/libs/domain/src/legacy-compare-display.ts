import type { InteractiveBlock } from "../../contracts/src/index.js";
import {
  classroomCompareTargetId,
  classroomFigureScopedTargetId,
  classroomStageTargetId,
  type MaterialFigureCaption,
} from "./material-cue.js";

type LegacyCompare = {
  type?: unknown;
  id?: unknown;
  left?: unknown;
  right?: unknown;
  sides?: unknown;
};
type Side = { id: string; label: string; points: string[] };

function sidesOf(block: LegacyCompare): Side[] {
  const sides =
    Array.isArray(block.sides) && block.sides.length >= 2
      ? block.sides
      : [block.left, block.right];
  return sides.map((value, index) => {
    const side =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    return {
      id:
        typeof side.id === "string"
          ? side.id
          : index === 0
            ? "left"
            : index === 1
              ? "right"
              : `side-${index}`,
      label: String(side.label ?? ""),
      points: Array.isArray(side.points) ? side.points.map(String) : [],
    };
  });
}

/** Read-time projection only. Never rewrite saved blocks, cue ids or revisions. */
export function legacyCompareDisplay(block: LegacyCompare) {
  const sides = sidesOf(block);
  const id = typeof block.id === "string" ? block.id : undefined;
  // Historical schemas had no side limit. Group surplus sides in the last
  // subview so the four-view layout never silently drops their content.
  const groups = sides
    .slice(0, 4)
    .map((side, index) => (index === 3 ? sides.slice(3) : [side]));
  const figures = groups.map((group, index) => ({
    type: "callout" as const,
    id: `legacy-compare:${id ?? "display"}:${index}`,
    variant: "definition" as const,
    title: group.map((side) => side.label).join(" / "),
    body: group
      .map((side) =>
        [...(group.length > 1 ? [side.label] : []), ...side.points].join(
          "\n\n",
        ),
      )
      .join("\n\n"),
  }));
  const display = {
    type: "stage",
    ...(id ? { id } : {}),
    layout: "split-h",
    figures,
  } as Extract<InteractiveBlock, { type: "stage" }>;

  const aliases = (side: Side, index: number) => {
    const names = [
      side.id,
      classroomCompareTargetId(index),
      index === 0 ? "left" : index === 1 ? "right" : `side-${index}`,
    ];
    return id
      ? [
          ...names,
          ...names.map((name) => classroomFigureScopedTargetId(id, name)),
        ]
      : names;
  };
  const targets = (targetIds: readonly string[]): string[] => {
    const selected = sides.flatMap((side, index) =>
      aliases(side, index).some((name) => targetIds.includes(name))
        ? [classroomStageTargetId("split-h", Math.min(index, 3))]
        : [],
    );
    if (selected.length) return [...new Set(selected)];
    return targetIds.some(
      (target) =>
        target === "whole" ||
        target === "compare" ||
        target === id ||
        (id && target === classroomFigureScopedTargetId(id, "compare")),
    )
      ? ["whole"]
      : [];
  };
  const captions = (
    values: readonly MaterialFigureCaption[],
  ): MaterialFigureCaption[] =>
    values.map((caption) => {
      const matched = sides.findIndex((side, index) =>
        aliases(side, index).some((name) =>
          (caption.targetIds ?? [caption.target]).includes(name),
        ),
      );
      if (matched < 0) return caption;
      const figureId = figures[Math.min(matched, 3)]!.id;
      return { ...caption, figureId, targetIds: [figureId] };
    });
  const objectIds = (targetIds: readonly string[]): string[] => {
    const selected = sides.flatMap((side, index) =>
      aliases(side, index).some((name) => targetIds.includes(name))
        ? [figures[Math.min(index, 3)]!.id]
        : [],
    );
    return selected.length ? [...new Set(selected)] : [id ?? "whole"];
  };
  return { display, targets, captions, objectIds };
}
