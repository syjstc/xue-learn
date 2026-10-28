const VIEW_BOX_ATTR_PATTERN =
  /\bviewBox\s*=\s*(["'])\s*(-?[\d.]+)(?:\s+|,)(-?[\d.]+)(?:\s+|,)([\d.]+)(?:\s+|,)([\d.]+)\s*\1/u;

const POINTS_ATTR = /(?:^|\s)points\s*=\s*(["'])([^"']*)\1/giu;

const PATH_D_ATTR = /(?:^|\s)d\s*=\s*(["'])([^"']*)\1/giu;

const TEXT_ATTRS =
  /<text\b([^>]*)>([^<]*)<\/text>/giu;

const FONT_SIZE_ATTR = /\bfont-size\s*=\s*(["'])([\d.]+)\1/iu;
const TEXT_X_ATTR = /\bx\s*=\s*(["'])(-?[\d.]+)\1/iu;
const TEXT_Y_ATTR = /\by\s*=\s*(["'])(-?[\d.]+)\1/iu;
const TEXT_ANCHOR_ATTR = /\btext-anchor\s*=\s*(["'])([^"']*)\1/iu;

const PADDING_RATIO = 0.04;
const MIN_PADDING = 8;
const TEXT_WIDTH_FACTOR = 0.62;

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function includePoint(bounds: Bounds | null, x: number, y: number): Bounds {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  if (!bounds) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  };
}

function includeRect(
  bounds: Bounds | null,
  x: number,
  y: number,
  width: number,
  height: number,
): Bounds | null {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 0 ||
    height < 0
  ) {
    return bounds;
  }
  return includePoint(includePoint(bounds, x, y), x + width, y + height);
}

function parseViewBox(svg: string): Bounds | null {
  const match = svg.match(VIEW_BOX_ATTR_PATTERN);
  if (!match) return null;
  const minX = Number(match[2]);
  const minY = Number(match[3]);
  const width = Number(match[4]);
  const height = Number(match[5]);
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { minX, minY, maxX: minX + width, maxY: minY + height };
}

function collectGeometryBounds(svg: string): Bounds | null {
  let bounds: Bounds | null = null;

  const elementPattern = /<(circle|ellipse|line|rect|polyline|polygon)\b([^>]*)\/?>/giu;
  let elementMatch: RegExpExecArray | null;
  while ((elementMatch = elementPattern.exec(svg))) {
    const tag = elementMatch[1]!.toLowerCase();
    const attrs = elementMatch[2] ?? "";
    const read = (name: string): number | null => {
      const match = attrs.match(
        new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(-?[\\d.]+)\\1`, "iu"),
      );
      if (!match) return null;
      const value = Number(match[2]);
      return Number.isFinite(value) ? value : null;
    };
    if (tag === "circle") {
      const cx = read("cx") ?? 0;
      const cy = read("cy") ?? 0;
      const r = read("r") ?? 0;
      bounds = includeRect(bounds, cx - r, cy - r, r * 2, r * 2);
      continue;
    }
    if (tag === "ellipse") {
      const cx = read("cx") ?? 0;
      const cy = read("cy") ?? 0;
      const rx = read("rx") ?? 0;
      const ry = read("ry") ?? 0;
      bounds = includeRect(bounds, cx - rx, cy - ry, rx * 2, ry * 2);
      continue;
    }
    if (tag === "line") {
      const x1 = read("x1") ?? 0;
      const y1 = read("y1") ?? 0;
      const x2 = read("x2") ?? 0;
      const y2 = read("y2") ?? 0;
      bounds = includePoint(includePoint(bounds, x1, y1), x2, y2);
      continue;
    }
    if (tag === "rect") {
      const x = read("x") ?? 0;
      const y = read("y") ?? 0;
      const width = read("width") ?? 0;
      const height = read("height") ?? 0;
      bounds = includeRect(bounds, x, y, width, height);
    }
  }

  POINTS_ATTR.lastIndex = 0;
  let pointsMatch: RegExpExecArray | null;
  while ((pointsMatch = POINTS_ATTR.exec(svg))) {
    const numbers = pointsMatch[2]!.match(/-?[\d.]+/gu) ?? [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      bounds = includePoint(bounds, Number(numbers[i]), Number(numbers[i + 1]));
    }
  }

  PATH_D_ATTR.lastIndex = 0;
  let pathMatch: RegExpExecArray | null;
  while ((pathMatch = PATH_D_ATTR.exec(svg))) {
    const numbers = pathMatch[2]!.match(/-?[\d.]+/gu) ?? [];
    // Approximate path extents from coordinate pairs in the path data.
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      bounds = includePoint(bounds, Number(numbers[i]), Number(numbers[i + 1]));
    }
  }

  TEXT_ATTRS.lastIndex = 0;
  let textMatch: RegExpExecArray | null;
  while ((textMatch = TEXT_ATTRS.exec(svg))) {
    const attrs = textMatch[1] ?? "";
    const content = textMatch[2] ?? "";
    const x = Number(attrs.match(TEXT_X_ATTR)?.[2] ?? "0");
    const y = Number(attrs.match(TEXT_Y_ATTR)?.[2] ?? "0");
    const fontSize = Number(attrs.match(FONT_SIZE_ATTR)?.[2] ?? "16");
    const anchor = attrs.match(TEXT_ANCHOR_ATTR)?.[2] ?? "start";
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(fontSize)) {
      continue;
    }
    const estimatedWidth = Math.max(fontSize, content.length * fontSize * TEXT_WIDTH_FACTOR);
    const left =
      anchor === "middle" ? x - estimatedWidth / 2 : anchor === "end" ? x - estimatedWidth : x;
    const right = left + estimatedWidth;
    bounds = includePoint(includePoint(bounds, left, y - fontSize), right, y + fontSize * 0.35);
  }

  return bounds;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Expand a course SVG root viewBox when authored geometry overflows it.
 * Safe for already-stored diagrams; never shrinks an existing viewBox.
 */
export function fitCourseSvgViewBox(svg: string): string {
  const source = svg.trim();
  if (!source.startsWith("<svg")) return svg;

  const viewBox = parseViewBox(source);
  const content = collectGeometryBounds(source);
  if (!viewBox || !content) return svg;

  const overflows =
    content.minX < viewBox.minX - 0.5 ||
    content.minY < viewBox.minY - 0.5 ||
    content.maxX > viewBox.maxX + 0.5 ||
    content.maxY > viewBox.maxY + 0.5;
  if (!overflows) return svg;

  const span = Math.max(
    content.maxX - content.minX,
    content.maxY - content.minY,
    viewBox.maxX - viewBox.minX,
    viewBox.maxY - viewBox.minY,
  );
  const padding = Math.max(MIN_PADDING, span * PADDING_RATIO);

  const nextMinX = Math.min(viewBox.minX, content.minX - padding);
  const nextMinY = Math.min(viewBox.minY, content.minY - padding);
  const nextMaxX = Math.max(viewBox.maxX, content.maxX + padding);
  const nextMaxY = Math.max(viewBox.maxY, content.maxY + padding);

  const nextWidth = nextMaxX - nextMinX;
  const nextHeight = nextMaxY - nextMinY;
  if (nextWidth <= 0 || nextHeight <= 0) return svg;

  const nextViewBox = `${formatNumber(nextMinX)} ${formatNumber(nextMinY)} ${formatNumber(nextWidth)} ${formatNumber(nextHeight)}`;
  let updated = source.replace(VIEW_BOX_ATTR_PATTERN, (_full, quote: string) => {
    return `viewBox=${quote}${nextViewBox}${quote}`;
  });

  // Drop fixed root sizing so responsive CSS/viewBox can own layout.
  updated = updated.replace(
    /^<svg\b([^>]*)>/u,
    (_full, attrs: string) => {
      const cleaned = attrs
        .replace(/\s+\b(?:width|height)\s*=\s*(["'])[^"']*\1/giu, "")
        .replace(/\s+/gu, " ")
        .trim();
      return `<svg${cleaned ? ` ${cleaned}` : ""}>`;
    },
  );

  return updated;
}
