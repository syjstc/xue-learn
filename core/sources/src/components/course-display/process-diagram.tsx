import { useId, type CSSProperties } from "react";
import {
  materialProcessLayout,
  materialProcessConnector,
  materialVisualTarget,
  type MaterialVisual,
} from "../../../libs/domain/src/index.js";
import { ProseMarkdown } from "../markdown/prose-markdown.js";

/** Basic SVG shapes + native Markdown/KaTeX, sharing the lesson's sampled frame. */
export function ProcessDiagram({
  block,
  emphasis,
}: {
  block: MaterialVisual;
  emphasis: readonly number[];
}) {
  const marker = useId().replace(/:/g, "");
  const layout = materialProcessLayout(block.items, emphasis);
  return (
    <div className="visual-process-viewport">
      <div
        className="visual-process-stage"
        style={
          {
            aspectRatio: `${layout.width} / ${layout.height}`,
            "--process-aspect": layout.width / layout.height,
          } as CSSProperties
        }
      >
        <svg
          className="visual-process-links"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
        >
          <defs>
            <marker
              id={marker}
              viewBox="0 0 12 12"
              markerUnits="userSpaceOnUse"
              refX="9"
              refY="6"
              markerWidth="12"
              markerHeight="12"
              orient="auto"
            >
              <path
                d="M5 2L9 6L5 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </marker>
          </defs>
          {layout.poses.slice(0, -1).map((pose, index) => (
            <path
              key={`${pose.id}:${layout.poses[index + 1]!.id}`}
              d={materialProcessConnector(pose, layout.poses[index + 1]!)}
              markerEnd={`url(#${marker})`}
            />
          ))}
        </svg>
        {layout.poses.map((pose, index) => {
          const item = block.items[index]!;
          return (
            <div
              key={pose.id}
              className="visual-process-object"
              data-lp-target={materialVisualTarget(block.id, item.id)}
              data-object-id={pose.id}
              data-active={(emphasis[index] ?? 0) > 0.5}
              style={
                {
                  left: `${(pose.x / layout.width) * 100}%`,
                  top: `${(pose.y / layout.height) * 100}%`,
                  width: `${(pose.width / layout.width) * 100}%`,
                  transform: `translate(-50%, -50%) scale(${pose.scale})`,
                  "--visual-object-emphasis": emphasis[index] ?? 0,
                  "--visual-emphasis": emphasis[index] ?? 0,
                  "--process-node-height": `${pose.height / 10}cqw`,
                } as CSSProperties
              }
            >
              <span className="visual-focus-indicator" data-focus-indicator={materialVisualTarget(block.id, item.id)}
                aria-hidden="true" style={{opacity: emphasis[index] ?? 0}}>
                <svg viewBox="0 0 12 12"><path d="M2 2L8 6L2 10"/></svg>
              </span>
              <div className="visual-process-node">
                <svg
                  viewBox={`0 0 ${pose.width} ${pose.height}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <rect
                    x="1"
                    y="1"
                    width={pose.width - 2}
                    height={pose.height - 2}
                    rx="14"
                  />
                </svg>
                <strong>
                  <ProseMarkdown content={item.label} variant="inline" />
                </strong>
              </div>
              {item.detail && (
                <div className="visual-process-detail">
                  <ProseMarkdown content={item.detail} variant="inline" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
