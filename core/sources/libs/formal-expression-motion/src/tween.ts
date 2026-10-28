import { stretchPath } from "./paths.js";
import type { MotionPrimitive, MotionScene } from "./types.js";

export type TweenFrame = {
  width: number;
  height: number;
  primitives: MotionPrimitive[];
};

const EPSILON = 0.001;

const RELATION_PUNCTUATION = new Set([
  "=",
  "+",
  "−",
  "-",
  "·",
  "⋅",
  "×",
  ",",
  "′",
  "'",
]);

type MotionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function easeOutQuint(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 5;
}

export function interpolateScenes(
  from: MotionScene | TweenFrame,
  to: MotionScene | TweenFrame,
  t: number,
): TweenFrame {
  if (t <= 0) return cloneFrame(from);
  if (t >= 1) return cloneFrame(to);
  const u = easeOutQuint(t);
  const fromMap = indexById(from.primitives);
  const toMap = indexById(to.primitives);
  const substituting = planRowSubstitution(from.primitives, to.primitives);
  const leavingIds = new Set(
    from.primitives
      .filter(
        (primitive) =>
          primitive.rowKey && substituting.leavingRowKeys.has(primitive.rowKey),
      )
      .map((primitive) => primitive.id),
  );
  const enteringIds = new Set(
    to.primitives
      .filter(
        (primitive) =>
          primitive.rowKey && substituting.enteringRowKeys.has(primitive.rowKey),
      )
      .map((primitive) => primitive.id),
  );
  const ids = new Set([...fromMap.keys(), ...toMap.keys()]);
  const primitives: MotionPrimitive[] = [];
  for (const id of ids) {
    const start = fromMap.get(id);
    const end = toMap.get(id);
    if (start && leavingIds.has(id)) {
      primitives.push(
        lerpSubstituting(start, substituting.target, substituting.fromRowRects, u),
      );
      continue;
    }
    if (end && enteringIds.has(id)) {
      primitives.push(
        lerpAppearing(end, substituting.source, substituting.toRowRects, u),
      );
      continue;
    }
    if (start && end) {
      primitives.push(lerpPrimitive(start, end, u));
      continue;
    }
    if (end) {
      primitives.push({
        ...end,
        opacity: end.opacity * u,
        em: lerp(end.em * 0.88, end.em, u),
        extent: end.extent ? lerp(end.extent * 0.72, end.extent, u) : end.extent,
      });
      continue;
    }
    if (start) {
      const target = substitutionTarget(start, to.primitives);
      const parked = target
        ? lerpPrimitive(start, { ...start, ...nudgeToward(start, target) }, u)
        : start;
      primitives.push({
        ...parked,
        opacity: start.opacity * (1 - u),
      });
    }
  }
  return {
    width: lerp(from.width, to.width, u),
    height: lerp(from.height, to.height, u),
    primitives,
  };
}

export function scenesEquivalent(a: MotionScene, b: MotionScene): boolean {
  if (a.primitives.length !== b.primitives.length) return false;
  if (Math.abs(a.width - b.width) > EPSILON || Math.abs(a.height - b.height) > EPSILON)
    return false;
  const other = indexById(b.primitives);
  for (const primitive of a.primitives) {
    const match = other.get(primitive.id);
    if (!match) return false;
    if (Math.abs(primitive.x - match.x) > 0.4) return false;
    if (Math.abs(primitive.y - match.y) > 0.4) return false;
    if (Math.abs(primitive.extent - match.extent) > 0.4) return false;
    if (primitive.text !== match.text) return false;
    if (primitive.role !== match.role) return false;
  }
  return true;
}

/**
 * Pick the scene to tween from. Prefer the last painted frame so a parent
 * re-render that drops `previousSnapshot` cannot snap the animation away.
 * Use `previous` only when the renderer remounted onto the destination already.
 */
export function resolveMotionFromScene(
  displayed: MotionScene,
  next: MotionScene,
  previous?: MotionScene,
): MotionScene {
  if (!scenesEquivalent(displayed, next)) return displayed;
  if (previous && !scenesEquivalent(previous, next)) return previous;
  return displayed;
}

export function withPaths(primitives: MotionPrimitive[]): Array<
  MotionPrimitive & { path: string }
> {
  return primitives.map((primitive) => ({
    ...primitive,
    path: primitive.role
      ? stretchPath(
          primitive.role,
          primitive.extent,
          primitive.em,
          primitive.width,
          { height: primitive.height, depth: primitive.depth },
        )
      : "",
  }));
}

function indexById(
  primitives: MotionPrimitive[],
): Map<string, MotionPrimitive> {
  return new Map(primitives.map((primitive) => [primitive.id, primitive]));
}

function cloneFrame(scene: MotionScene | TweenFrame): TweenFrame {
  return {
    width: scene.width,
    height: scene.height,
    primitives: scene.primitives.map((primitive) => ({ ...primitive })),
  };
}

function planRowSubstitution(
  from: MotionPrimitive[],
  to: MotionPrimitive[],
): {
  leavingRowKeys: Set<string>;
  enteringRowKeys: Set<string>;
  fromRowRects: Map<string, MotionRect>;
  toRowRects: Map<string, MotionRect>;
  target?: MotionRect;
  source?: MotionRect;
} {
  const fromIds = new Set(from.map((primitive) => primitive.id));
  const toIds = new Set(to.map((primitive) => primitive.id));
  const unmatchedFrom = from.filter((primitive) => !toIds.has(primitive.id));
  const unmatchedTo = to.filter((primitive) => !fromIds.has(primitive.id));
  const keptFromRowKeys = rowKeysWithPersistedIds(from, toIds);
  const keptToRowKeys = rowKeysWithPersistedIds(to, fromIds);
  const leavingRows = fullyTransientRows(from, keptFromRowKeys);
  const enteringRows = fullyTransientRows(to, keptToRowKeys);
  const enterItems = unmatchedTo.map((primitive) => ({
    rect: primitiveRect(primitive),
    signature: primitive.text,
  }));
  const leaveItems = unmatchedFrom.map((primitive) => ({
    rect: primitiveRect(primitive),
    signature: primitive.text,
  }));
  const leavingRowKeys = new Set(
    planSubstitutingRowKeys({
      leavingRows,
      keptRowLeavingSignatures: unmatchedFrom
        .filter(
          (primitive) =>
            primitive.rowKey && keptFromRowKeys.has(primitive.rowKey),
        )
        .map((primitive) => primitive.text),
      enterSignatures: enterItems.map((item) => item.signature),
    }),
  );
  const enteringRowKeys = new Set(
    leavingRowKeys.size
      ? []
      : planSubstitutingRowKeys({
          leavingRows: enteringRows,
          keptRowLeavingSignatures: unmatchedTo
            .filter(
              (primitive) =>
                primitive.rowKey && keptToRowKeys.has(primitive.rowKey),
            )
            .map((primitive) => primitive.text),
          enterSignatures: leaveItems.map((item) => item.signature),
        }),
  );
  const leavingSignatures = leavingRows
    .filter((row) => leavingRowKeys.has(row.rowKey))
    .flatMap((row) => row.signatures);
  const enteringSignatures = enteringRows
    .filter((row) => enteringRowKeys.has(row.rowKey))
    .flatMap((row) => row.signatures);
  return {
    leavingRowKeys,
    enteringRowKeys,
    fromRowRects: rowRectsFor(from, leavingRowKeys),
    toRowRects: rowRectsFor(to, enteringRowKeys),
    target: unionRects(
      enterRectsForSubstitution(enterItems, leavingSignatures),
    ),
    source: unionRects(
      enterRectsForSubstitution(leaveItems, enteringSignatures),
    ),
  };
}

function rowKeysWithPersistedIds(
  primitives: MotionPrimitive[],
  otherIds: Set<string>,
): Set<string> {
  const keys = new Set<string>();
  for (const primitive of primitives) {
    if (primitive.rowKey && otherIds.has(primitive.id)) {
      keys.add(primitive.rowKey);
    }
  }
  return keys;
}

function fullyTransientRows(
  primitives: MotionPrimitive[],
  keptRowKeys: Set<string>,
): Array<{ rowKey: string; signatures: string[] }> {
  const unmatchedKeys = [
    ...new Set(
      primitives
        .map((primitive) => primitive.rowKey)
        .filter(
          (rowKey): rowKey is string =>
            typeof rowKey === "string" && !keptRowKeys.has(rowKey),
        ),
    ),
  ];
  return unmatchedKeys.map((rowKey) => ({
    rowKey,
    signatures: primitives
      .filter((primitive) => primitive.rowKey === rowKey)
      .map((primitive) => primitive.text),
  }));
}

function rowRectsFor(
  primitives: MotionPrimitive[],
  rowKeys: Set<string>,
): Map<string, MotionRect> {
  const rowRects = new Map<string, MotionRect>();
  for (const rowKey of rowKeys) {
    const rect = unionRects(
      primitives
        .filter((primitive) => primitive.rowKey === rowKey)
        .map(primitiveRect),
    );
    if (rect) rowRects.set(rowKey, rect);
  }
  return rowRects;
}

function planSubstitutingRowKeys(args: {
  leavingRows: readonly { rowKey: string; signatures: readonly string[] }[];
  keptRowLeavingSignatures: readonly string[];
  enterSignatures: readonly string[];
}): string[] {
  if (args.leavingRows.length !== 1) return [];
  if (args.keptRowLeavingSignatures.length === 0) return [];
  const leaving = args.leavingRows[0];
  const leavingContent = new Set(contentSignatures(leaving.signatures));
  const enterContent = contentSignatures(args.enterSignatures);
  if (leavingContent.size === 0 || enterContent.length === 0) return [];
  const overlap = enterContent.filter((signature) => leavingContent.has(signature));
  if (overlap.length === 0) return [];
  return [leaving.rowKey];
}

function contentSignatures(signatures: readonly string[]): string[] {
  return signatures.filter(
    (signature) => signature.length > 0 && !RELATION_PUNCTUATION.has(signature),
  );
}

function enterRectsForSubstitution(
  enterItems: readonly { rect: MotionRect; signature: string }[],
  leavingSignatures: readonly string[],
): MotionRect[] {
  const leavingSet = new Set(
    leavingSignatures.filter((signature) => signature.length > 0),
  );
  return enterItems
    .filter((item) => leavingSet.has(item.signature))
    .map((item) => item.rect);
}

function lerpAppearing(
  end: MotionPrimitive,
  source: MotionRect | undefined,
  rowRects: Map<string, MotionRect>,
  t: number,
): MotionPrimitive {
  const parked = lerpSubstituting(end, source, rowRects, 1 - t);
  return { ...parked, opacity: end.opacity * t };
}

function lerpSubstituting(
  start: MotionPrimitive,
  target: MotionRect | undefined,
  rowRects: Map<string, MotionRect>,
  t: number,
): MotionPrimitive {
  const row = start.rowKey ? rowRects.get(start.rowKey) : undefined;
  if (!row || !target) {
    return { ...start, opacity: start.opacity * (1 - t) };
  }
  const fromCx = row.left + row.width / 2;
  const fromCy = row.top + row.height / 2;
  const toCx = target.left + target.width / 2;
  const toCy = target.top + target.height / 2;
  const scale =
    row.width > 0 && row.height > 0
      ? Math.min(target.width / row.width, target.height / row.height, 1)
      : 1;
  const s = lerp(1, scale, t);
  const cx = lerp(fromCx, toCx, t);
  const cy = lerp(fromCy, toCy, t);
  const visH = start.height + start.depth;
  const primCx = start.x + start.width / 2;
  const primCy = start.y - start.height + visH / 2;
  const outW = start.width * s;
  const outH = start.height * s;
  const outD = start.depth * s;
  const outCx = cx + (primCx - fromCx) * s;
  const outCy = cy + (primCy - fromCy) * s;
  return {
    ...start,
    x: outCx - outW / 2,
    y: outCy + outH / 2 - outD / 2,
    width: outW,
    height: outH,
    depth: outD,
    em: start.em * s,
    extent: start.extent * s,
    opacity: start.opacity * (1 - t),
  };
}

function lerpPrimitive(
  from: MotionPrimitive,
  to: MotionPrimitive,
  t: number,
): MotionPrimitive {
  return {
    ...to,
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
    depth: lerp(from.depth, to.depth, t),
    opacity: lerp(from.opacity, to.opacity, t),
    em: lerp(from.em, to.em, t),
    extent: lerp(from.extent, to.extent, t),
    italic: t < 0.5 ? from.italic : to.italic,
    text: t < 0.5 ? from.text : to.text,
    role: to.role ?? from.role,
  };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function substitutionTarget(
  leaving: MotionPrimitive,
  incoming: MotionPrimitive[],
): MotionPrimitive | undefined {
  const leavers = incoming.filter(
    (candidate) =>
      candidate.text &&
      candidate.text === leaving.text &&
      overlaps(leaving, candidate),
  );
  if (leavers.length === 1) return leavers[0];
  return incoming.find((candidate) => overlaps(leaving, candidate));
}

function overlaps(a: MotionPrimitive, b: MotionPrimitive): boolean {
  const ax1 = a.x;
  const ay1 = a.y - a.height;
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.depth;
  const bx1 = b.x;
  const by1 = b.y - b.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.depth;
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

function nudgeToward(
  from: MotionPrimitive,
  to: MotionPrimitive,
): Pick<MotionPrimitive, "x" | "y" | "width" | "height" | "depth" | "em"> {
  const scale = Math.min(
    to.width / Math.max(from.width, 1),
    to.height / Math.max(from.height, 1),
    1,
  );
  return {
    x: to.x + to.width / 2 - from.width / 2,
    y: to.y + (to.height - from.height) / 2,
    width: from.width,
    height: from.height,
    depth: from.depth,
    em: from.em * scale,
  };
}

function primitiveRect(primitive: MotionPrimitive): MotionRect {
  return {
    left: primitive.x,
    top: primitive.y - primitive.height,
    width: primitive.width,
    height: primitive.height + primitive.depth,
  };
}

function unionRects(rects: readonly MotionRect[]): MotionRect | undefined {
  if (rects.length === 0) return undefined;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}
