import type { MaterialVisual } from "./material-visual.js";

export type MaterialProcessPose = Readonly<{
  id: string;
  x: number;
  y: number;
  flowY: number;
  direction: 1 | -1;
  width: number;
  height: number;
  scale: number;
}>;

/** Renderer-neutral object poses, sampled from the existing presentation clock.
 * Keep order and text width fixed; focus moves the same objects without reflow. */
export function materialProcessLayout(
  items: MaterialVisual["items"],
  emphasis: readonly number[],
) {
  const count = items.length;
  const columns = count === 4 ? 2 : Math.min(count, 3);
  const rows = Math.ceil(count / columns);
  const poses: MaterialProcessPose[] = [];
  // Conservative line budget in the same design units as the DOM type sizes.
  // This only measures copy; it never changes or truncates authored teaching text.
  const lines = (text: string, width: number, font: number) => {
    const units = Array.from(text).reduce(
      (sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 1 : 0.62),
      0,
    );
    return Math.max(1, Math.ceil(units / Math.max(1, width / font)));
  };
  let rowTop = 0;
  for (let row = 0; row < rows; row++) {
    const members = items.slice(row * columns, (row + 1) * columns);
    const direction = row % 2 ? -1 : 1;
    const width =
      rows > 1
        ? columns === 2
          ? 340
          : 230
        : Math.min(270, 690 / members.length);
    const heights = members.map((item) =>
      Math.max(128, lines(item.label, width - 40, 31) * 42 + 24),
    );
    const flowY = rowTop + (rows > 1 ? Math.max(...heights) * 0.56 + 50 : 165);
    const weights = members.map((_, index) => {
      const value = emphasis[row * columns + index] ?? 0;
      return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    });
    const total = weights.reduce((sum, e) => sum + 1 + e * 0.3, 0);
    let cursor = 70;
    let rowBottom = rows > 1 ? rowTop : rowTop + 360;
    for (let index = 0; index < members.length; index++) {
      const e = weights[index]!;
      const cell = ((1 + e * 0.3) / total) * 860;
      const nodeHeight = heights[index]!;
      const detailLines = members[index]!.detail
        ? lines(members[index]!.detail!, width * 1.1, 25)
        : 0;
      rowBottom = Math.max(
        rowBottom,
        flowY +
          (nodeHeight / 2 + 22 + detailLines * 39) * 1.12 +
          (rows > 1 ? 20 : 40),
      );
      poses.push({
        id: members[index]!.id,
        x:
          rows > 1
            ? 70 +
              (((direction === 1 ? index : columns - 1 - index) + 0.5) * 860) /
                columns
            : cursor + cell / 2,
        y: flowY - e * 34,
        flowY,
        direction,
        width,
        height: nodeHeight,
        scale: 1 + e * 0.12,
      });
      cursor += cell;
    }
    rowTop = rowBottom;
  }
  return { width: 1000, height: rowTop, poses };
}

/** Ports are recalculated from the same frame's object geometry. */
export function materialProcessConnector(
  from: MaterialProcessPose,
  to: MaterialProcessPose,
): string {
  // Keep a short, equal gap at each box edge. Same-row links follow one stable
  // flow line, inside both side faces even when the focused box rises/scales.
  const x1 = from.x + from.direction * ((from.width / 2) * from.scale + 6);
  if (to.flowY !== from.flowY) {
    // Adjacent rows turn on the same side instead of crossing the full board.
    const x2 = to.x + from.direction * ((to.width / 2) * to.scale + 6);
    const turnX =
      from.direction === 1 ? Math.max(x1, x2) + 24 : Math.min(x1, x2) - 24;
    return `M ${x1} ${from.flowY} H ${turnX} V ${to.flowY} H ${x2}`;
  }
  const x2 = to.x - from.direction * ((to.width / 2) * to.scale + 6);
  return `M ${x1} ${from.flowY} H ${x2}`;
}
