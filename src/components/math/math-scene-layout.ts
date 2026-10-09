import type { MathScene } from "@xue-learn/core/source/libs/domain/src/index.ts";

export type MathScene2dScale = {
  x: number;
  y: number;
};

/**
 * Geometric scenes need equal unit scales so circles and angles stay true.
 * Cartesian function plots use independent axis scales, like a normal graph,
 * so unrelated x/y units do not collapse the plot into a narrow strip.
 */
export function resolveMathScene2dScale(
  scene: MathScene,
  availableWidth: number,
  availableHeight: number,
  xSpan: number,
  ySpan: number,
): MathScene2dScale {
  const xScale = availableWidth / xSpan;
  const yScale = availableHeight / ySpan;
  const hasCartesianFunction =
    scene.coordinateSystem === "cartesian" &&
    scene.objects.some((object) => object.kind === "function");

  if (hasCartesianFunction) return { x: xScale, y: yScale };

  const equalScale = Math.min(xScale, yScale);
  return { x: equalScale, y: equalScale };
}
