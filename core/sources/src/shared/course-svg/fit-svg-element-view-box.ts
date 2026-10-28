/** Expand an in-DOM course SVG viewBox to include overflowed geometry. */
export function fitSvgElementViewBox(root: SVGSVGElement): void {
  let bbox: DOMRect;
  try {
    bbox = root.getBBox();
  } catch {
    return;
  }
  if (
    !Number.isFinite(bbox.width) ||
    !Number.isFinite(bbox.height) ||
    bbox.width <= 0 ||
    bbox.height <= 0
  ) {
    return;
  }

  const vb = root.viewBox.baseVal;
  const hasViewBox =
    root.hasAttribute("viewBox") &&
    Number.isFinite(vb.width) &&
    vb.width > 0 &&
    Number.isFinite(vb.height) &&
    vb.height > 0;
  if (!hasViewBox) return;

  const overflows =
    bbox.x < vb.x - 0.5 ||
    bbox.y < vb.y - 0.5 ||
    bbox.x + bbox.width > vb.x + vb.width + 0.5 ||
    bbox.y + bbox.height > vb.y + vb.height + 0.5;
  if (!overflows) return;

  const padding = Math.max(8, Math.max(bbox.width, bbox.height) * 0.04);
  const nextMinX = Math.min(vb.x, bbox.x - padding);
  const nextMinY = Math.min(vb.y, bbox.y - padding);
  const nextMaxX = Math.max(vb.x + vb.width, bbox.x + bbox.width + padding);
  const nextMaxY = Math.max(vb.y + vb.height, bbox.y + bbox.height + padding);
  const nextWidth = nextMaxX - nextMinX;
  const nextHeight = nextMaxY - nextMinY;
  if (nextWidth <= 0 || nextHeight <= 0) return;

  const round = (value: number) => String(Math.round(value * 100) / 100);
  root.setAttribute(
    "viewBox",
    `${round(nextMinX)} ${round(nextMinY)} ${round(nextWidth)} ${round(nextHeight)}`,
  );
  root.removeAttribute("width");
  root.removeAttribute("height");
  if (!root.getAttribute("preserveAspectRatio")) {
    root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }
}
