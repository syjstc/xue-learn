type Annotation = {
  id: string;
  center: number;
  width: number;
  height: number;
};

/** Pack measured captions in pitch order. Reserve every caption, even when its cue is hidden. */
export function layoutMusicAnnotations(
  annotations: readonly Annotation[],
  availableWidth: number,
  gap = 8,
) {
  const rows: Annotation[][] = [];
  let used = 0;
  for (const item of [...annotations].sort((a, b) => a.center - b.center)) {
    const row = rows.at(-1);
    if (!row || used + gap + item.width > availableWidth) {
      rows.push([item]);
      used = item.width;
    } else {
      row.push(item);
      used += gap + item.width;
    }
  }
  const boxes = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  let y = 0;
  for (const row of rows) {
    const positions: number[] = [];
    let edge = 0;
    for (const item of row) {
      const left = Math.max(edge, item.center - item.width / 2);
      positions.push(left);
      edge = left + item.width + gap;
    }
    // Push the row back from the right edge, keeping the order and all gaps.
    edge = availableWidth;
    for (let i = row.length - 1; i >= 0; i--) {
      const item = row[i]!;
      positions[i] = Math.min(positions[i]!, edge - item.width);
      edge = positions[i]! - gap;
      boxes.set(item.id, {
        x: positions[i]!,
        y,
        width: item.width,
        height: item.height,
      });
    }
    y += Math.max(...row.map((item) => item.height)) + gap;
  }
  return { boxes, height: rows.length ? y - gap : 0 };
}

/** Route a leader through the gaps of lower caption rows, never through their copy. */
export function routeMusicAnnotation(
  start: { x: number; y: number },
  target: { x: number; y: number },
  obstacles: readonly { x: number; y: number; width: number; height: number }[],
) {
  const rowBottom = Math.max(
    start.y,
    ...obstacles
      .filter((box) => box.y < start.y && box.y + box.height >= start.y)
      .map((box) => box.y + box.height),
  );
  const points = [start, { x: start.x, y: rowBottom + 4 }];
  let current = points[1]!;
  const rows = new Map<number, (typeof obstacles)[number][]>();
  for (const box of obstacles) {
    if (box.y <= current.y || box.y >= target.y) continue;
    rows.set(box.y, [...(rows.get(box.y) ?? []), box]);
  }
  for (const [top, boxes] of [...rows].sort(([a], [b]) => a - b)) {
    const candidates = [
      target.x,
      current.x,
      ...boxes.flatMap((b) => [b.x - 4, b.x + b.width + 4]),
    ];
    const clear = (x: number) =>
      boxes.every((b) => x <= b.x - 3 || x >= b.x + b.width + 3);
    const cost = (x: number) =>
      Math.abs(x - current.x) + Math.abs(x - target.x);
    const x = candidates.filter(clear).sort((a, b) => cost(a) - cost(b))[0]!;
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    points.push(
      { x: current.x, y: top - 4 },
      { x, y: top - 4 },
      { x, y: bottom + 4 },
    );
    current = { x, y: bottom + 4 };
  }
  points.push(target);
  return points
    .map((p, index) => `${index ? "L" : "M"}${p.x},${p.y}`)
    .join(" ");
}
