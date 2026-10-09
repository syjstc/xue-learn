import { DEFAULT_EM } from "./metrics.js";

/** Floor so mobile/narrow hosts still keep stems above a hairline. */
export const MIN_MOTION_EM = 14;
/** Cap so a huge stage does not blow type past display size. */
export const MAX_MOTION_EM = 40;

export function fitMotionEm(args: {
  designWidth: number;
  designHeight: number;
  availableWidth: number;
  availableHeight: number;
  designEm?: number;
  minEm?: number;
  maxEm?: number;
}): number {
  const designEm = args.designEm ?? DEFAULT_EM;
  const minEm = args.minEm ?? MIN_MOTION_EM;
  const maxEm = args.maxEm ?? MAX_MOTION_EM;
  if (args.availableWidth < 8 || args.availableHeight < 8) return designEm;
  const sx = args.availableWidth / Math.max(args.designWidth, 1);
  const sy = args.availableHeight / Math.max(args.designHeight, 1);
  const fitted = designEm * Math.min(sx, sy);
  return Math.min(maxEm, Math.max(minEm, fitted));
}
