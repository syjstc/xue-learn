"use client";
import { useT } from "@xue-learn/core/i18n";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  classroomStageTargetId,
  isMaterialStageLayout,
  layoutSlots,
  materialStageFocusIndexes,
  resolveMaterialStageLayout,
  materialStageItemStyle,
  materialCueIdentity,
  materialCueNodeLit,
  blockFigureId,
  captionsForFigure,
  type MaterialFigureCaption,
  type MaterialStageLayout,
} from "@xue-learn/core/domain";
import type { InteractiveBlock } from "@xue-learn/core/schemas";
import { cn } from "@xue-learn/core/utils";
import { MaterialFigureCaptions } from "./figure-captions.tsx";

type StageBlock = Extract<InteractiveBlock, { type: "stage" }>;

export function ComposedStageBlock({
  block,
  activeTargetIds = [],
  guided = false,
  figureCaptions = [],
  renderFigure,
}: {
  block: StageBlock;
  activeTargetIds?: readonly string[];
  guided?: boolean;
  figureCaptions?: readonly MaterialFigureCaption[];
  renderFigure: (
    figure: InteractiveBlock,
    index: number,
    captions: readonly MaterialFigureCaption[],
  ) => ReactNode;
}) {
  const t = useT();
  const layout: MaterialStageLayout = isMaterialStageLayout(block.layout)
    ? block.layout
    : "stack";
  const slots = layoutSlots(layout, block.figures.length);
  const effectiveTargetIds = guided ? activeTargetIds : [];
  const cued = effectiveTargetIds.length > 0;
  const [narrow, setNarrow] = useState(false);
  const [manualFocusIndexes, setManualFocusIndexes] = useState<number[]>([]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const cueFocusIndexes = materialStageFocusIndexes({
    layout,
    figures: block.figures,
    targetIds: effectiveTargetIds,
  });
  const focusedIndexes =
    cued ||
    effectiveTargetIds.some(
      (targetId) => targetId === "whole" || targetId === "display",
    )
      ? cueFocusIndexes
      : manualFocusIndexes;
  const plan = useMemo(
    () =>
      resolveMaterialStageLayout({
        layout,
        figures: block.figures,
        surface: narrow ? "reading-narrow" : "reading-wide",
        focusedIndexes,
      }),
    [block.figures, focusedIndexes, layout, narrow],
  );
  const itemByIndex = new Map(plan.items.map((item) => [item.index, item]));
  const canManuallyFocus = !guided;
  return (
    <div
      className={cn(
        "material-cue-board material-composed-stage",
        plan.presentation === "focus" && "is-focused",
      )}
      data-layout={layout}
      data-text-only={
        block.figures.every(
          (figure) => figure.type === "callout" || figure.type === "accordion",
        )
          ? "true"
          : undefined
      }
      data-surface={narrow ? "narrow" : "wide"}
      data-presentation={plan.presentation}
      data-cued={cued ? "true" : undefined}
      data-whole={effectiveTargetIds.includes("whole") ? "true" : undefined}
      data-cue-id={cued ? materialCueIdentity(effectiveTargetIds) : undefined}
    >
      {canManuallyFocus && plan.presentation === "focus" ? (
        <button
          type="button"
          className="material-stage-reset"
          onClick={() => setManualFocusIndexes([])}
        >
          {t("desktop.ui.composedStage.showAll")}
        </button>
      ) : null}
      <div className="material-stage-layout">
        {plan.order.map((index) => {
          const figure = block.figures[index]!;
          const item = itemByIndex.get(index)!;
          const targetId = classroomStageTargetId(layout, index);
          const lit =
            materialCueNodeLit(effectiveTargetIds, targetId) || item.focused;
          return (
            <div
              key={`${slots[index] ?? index}`}
              className="material-cue-slot min-w-0"
              style={materialStageItemStyle(item)}
              data-lit={lit ? "true" : undefined}
              data-focused={item.focused ? "true" : undefined}
              data-stage-index={index}
              data-stage-density={item.density}
            >
              {canManuallyFocus ? (
                <button
                  type="button"
                  className="material-stage-focus"
                  aria-label={t("desktop.i18n.focusSubview", {
                    number: index + 1,
                  })}
                  aria-pressed={item.focused}
                  onClick={() =>
                    setManualFocusIndexes((current) =>
                      current.includes(index)
                        ? current.filter((value) => value !== index)
                        : [...current, index],
                    )
                  }
                >
                  {item.focused
                    ? t("desktop.ui.composedStage.clearFocus")
                    : t("desktop.ui.composedStage.focus")}
                </button>
              ) : null}
              {renderFigure(
                figure,
                index,
                captionsForFigure(
                  figureCaptions,
                  blockFigureId(figure) || undefined,
                ),
              )}
              {figure.type === "compare" ? null : (
                <MaterialFigureCaptions
                  captions={captionsForFigure(
                    figureCaptions,
                    blockFigureId(figure) || undefined,
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="material-stage-whole-captions">
        <MaterialFigureCaptions
          captions={captionsForFigure(
            figureCaptions,
            blockFigureId(block) || undefined,
            "whole",
          )}
        />
      </div>
    </div>
  );
}
