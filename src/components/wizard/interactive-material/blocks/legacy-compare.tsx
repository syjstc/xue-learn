"use client";

import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import { compareBlockSides } from "@xue-learn/core/source/src/shared/domain/compare-block.ts";
import {
  legacyCompareDisplay,
  type MaterialFigureCaption,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import type { TextHighlightSpan } from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import type { MaterialFollowUpHandlers } from "@/hooks/use-material-text-selection";
import { Selectable } from "../selectable.tsx";
import { ComposedStageBlock } from "./composed-stage.tsx";

export function LegacyCompareBlock({
  block,
  blockKey,
  highlights,
  sources,
  followUp,
  activeTargetIds = [],
  figureCaptions = [],
}: {
  block: Extract<InteractiveBlock, { type: "compare" }>;
  blockKey: string;
  compact?: boolean;
  highlights: Map<string, TextHighlightSpan[]>;
  sources?: ContentSource[];
  followUp?: MaterialFollowUpHandlers;
  activeTargetIds?: readonly string[];
  figureCaptions?: readonly MaterialFigureCaption[];
}) {
  const projection = legacyCompareDisplay(block);
  const sides = compareBlockSides(block);
  return (
    <ComposedStageBlock
      block={projection.display}
      activeTargetIds={projection.targets(activeTargetIds)}
      guided={activeTargetIds.length > 0}
      figureCaptions={projection.captions(figureCaptions)}
      renderFigure={(_figure, index) => (
        <div className="text-[var(--course-content)]">
          {(index === 3 ? sides.slice(3) : [sides[index]!]).map(
            (side, offset) => {
              const sideIndex = index + offset;
              return (
                <div key={sideIndex}>
                  <div className="text-sm font-semibold">
                    <Selectable
                      contentKey={`${blockKey}:side:${sideIndex}:label`}
                      text={side.label}
                      highlights={highlights}
                      sources={sources}
                      followUp={followUp}
                      markdownVariant="inline"
                    />
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {side.points.map((point, pointIndex) => (
                      <li key={pointIndex}>
                        <Selectable
                          contentKey={`${blockKey}:side:${sideIndex}:${pointIndex}`}
                          text={point}
                          highlights={highlights}
                          sources={sources}
                          followUp={followUp}
                          markdownVariant="inline"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            },
          )}
        </div>
      )}
    />
  );
}
