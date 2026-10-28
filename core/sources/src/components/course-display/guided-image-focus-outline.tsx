import { useId } from "react";
import {
  imagePolygonPath,
  type GuidedImageHighlightFrame,
} from "../../../libs/domain/src/index.js";
import "./guided-image-focus-outline.css";

/** Quiet corner marks identify each subject without tracing the jagged union
 * of its observed shapes. The union mask keeps all source content untouched. */
export function GuidedImageFocusOutline({
  frame,
  width,
  height,
}: {
  frame: GuidedImageHighlightFrame;
  width: number;
  height: number;
}) {
  const uid = useId().replace(/:/g, "");
  if (!frame.highlights.length) return null;
  const paths = frame.highlights.flatMap(({ region }) =>
    region.polygons.map((polygon, index) => ({
      key: `${region.id}-${index}`,
      d: imagePolygonPath(polygon, width, height),
    })),
  );
  const corners = frame.highlights.map(({ region, opacity }) => {
    const points = region.polygons.flatMap((polygon) => polygon.outer);
    const gap = Math.min(width, height) * 0.006;
    const left = Math.min(...points.map((point) => point.x)) * width - gap;
    const right = Math.max(...points.map((point) => point.x)) * width + gap;
    const top = Math.min(...points.map((point) => point.y)) * height - gap;
    const bottom = Math.max(...points.map((point) => point.y)) * height + gap;
    const length = Math.min(
      Math.min(width, height) * 0.025,
      (right - left) * 0.18,
      (bottom - top) * 0.18,
    );
    const radius = length * 0.35;
    return {
      key: region.id,
      opacity,
      d: [
        `M${left + length},${top} H${left + radius} Q${left},${top} ${left},${top + radius} V${top + length}`,
        `M${right - length},${top} H${right - radius} Q${right},${top} ${right},${top + radius} V${top + length}`,
        `M${left},${bottom - length} V${bottom - radius} Q${left},${bottom} ${left + radius},${bottom} H${left + length}`,
        `M${right},${bottom - length} V${bottom - radius} Q${right},${bottom} ${right - radius},${bottom} H${right - length}`,
      ].join(" "),
    };
  });
  return (
    <g aria-hidden="true" pointerEvents="none">
      <defs>
        <mask
          id={`${uid}-outline-exterior`}
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={width}
          height={height}
          style={{ maskType: "luminance" }}
        >
          <rect width={width} height={height} fill="white" />
          {paths.map(({ key, d }) => (
            <path key={key} d={d} fill="black" fillRule="evenodd" />
          ))}
        </mask>
      </defs>
      <g
        className="guided-image-focus-outline"
        mask={`url(#${uid}-outline-exterior)`}
      >
        {corners.map(({ key, d, opacity }) => (
          <path
            key={key}
            d={d}
            opacity={opacity}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </g>
  );
}
