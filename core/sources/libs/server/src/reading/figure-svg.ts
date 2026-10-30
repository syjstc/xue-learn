import {assertCourseSvgRenderable} from "../llm/safe-svg.js";

/** Constrain newly authored reading diagrams; saved course art stays intact. */
export function assertReadingSvgRenderable(svg: string): string {
  assertCourseSvgRenderable(svg);
  const root = svg.match(/^<svg\b[^>]*>/iu)?.[0];
  const viewBox = root?.match(/\bviewBox\s*=\s*(["'])([^"']+)\1/iu)?.[2]
    .trim().split(/[\s,]+/u).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) ||
    viewBox[2] <= 0 || viewBox[3] <= 0 || viewBox[2] > 800 || viewBox[3] > 1000) {
    throw Error("Reading SVG requires a finite positive viewBox no wider than 800 and no taller than 1000. Redesign with short labels and a vertical layout; keep secondary text at least 22px.");
  }
  return svg;
}
