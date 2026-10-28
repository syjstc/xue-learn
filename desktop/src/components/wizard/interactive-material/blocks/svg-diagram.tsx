import { StageStaticSvg } from "@xue-learn/core/display/course-board-media";
("use client");

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Hand, ImageIcon, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
  fitCourseSvgViewBox,
  normalizeCourseSvgTextPaint,
} from "@xue-learn/core/domain";
import type { InteractiveBlock } from "@xue-learn/core/schemas";
import { useT } from "@xue-learn/core/i18n";
import { isDev } from "@xue-learn/core/dev";
import { isImageGenerationFeatureEnabled } from "@xue-learn/core/features";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
import { consumeSsePost } from "@/shared/client/consume-sse";
import { useImageSettings } from "@/hooks/api";
import { cn } from "@xue-learn/core/utils";
import {
  MaterialVisualFrame,
  MaterialVisualToolbar,
  MaterialVisualToolbarButton,
} from "@xue-learn/core/components/wizard/interactive-material/material-visual-frame";
import type { IllustrationRegenHandlers } from "../types.ts";

const MIN_SCALE = 0.75;
const MAX_SCALE = 4;

type ViewTransform = { x: number; y: number; scale: number };

const INITIAL_TRANSFORM: ViewTransform = { x: 0, y: 0, scale: 1 };

function svgThemeClass(svg: string): string {
  // Newly generated diagrams use inherited currentColor on a transparent
  // canvas. Older persisted diagrams have a fixed light palette, so give
  // only those diagrams a dark-mode compatibility treatment.
  return /\bcurrentColor\b/u.test(svg)
    ? "course-svg"
    : "course-svg course-svg--legacy";
}

function CourseSvgMarkup({
  svg,
  alt,
  className,
}: {
  svg: string;
  alt?: string;
  className: string;
}) {
  const fittedSvg = useMemo(
    () => normalizeCourseSvgTextPaint(fitCourseSvgViewBox(svg)),
    [svg],
  );
  return (
    <StageStaticSvg
      markup={fittedSvg}
      className={className}
      alt={alt}
      stage={false}
    />
  );
}

export function SvgDiagramBlock({
  block,
  blockIndex,
  compact,
  illustrationRegen,
}: {
  block: Extract<InteractiveBlock, { type: "svg" }>;
  blockIndex?: number;
  compact?: boolean;
  illustrationRegen?: IllustrationRegenHandlers;
}) {
  const t = useT();
  const themeClass = svgThemeClass(block.svg);
  const [isExpanded, setIsExpanded] = useState(false);
  const [transform, setTransform] = useState<ViewTransform>(INITIAL_TRANSFORM);
  const [replacing, setReplacing] = useState(false);
  const [replaceProgress, setReplaceProgress] = useState("");
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null,
  );
  const imageFeatureEnabled = isImageGenerationFeatureEnabled(
    isDesktopLocalRuntime(),
  );
  const imageSettingsQuery = useImageSettings(
    imageFeatureEnabled && isDesktopLocalRuntime() && isDev(),
  );
  const imageGenerationEnabled = Boolean(
    imageFeatureEnabled &&
    imageSettingsQuery.data?.config.enabled &&
    imageSettingsQuery.data?.config.provider !== "none",
  );
  const imageProviderConfigured = Boolean(
    imageSettingsQuery.data?.providers.find(
      (provider) => provider.id === imageSettingsQuery.data?.config.provider,
    )?.configured,
  );
  const canReplaceWithIllustration = Boolean(
    isDesktopLocalRuntime() &&
    isDev() &&
    illustrationRegen?.unitId &&
    blockIndex !== undefined &&
    imageGenerationEnabled &&
    imageProviderConfigured,
  );

  const resetView = () => setTransform(INITIAL_TRANSFORM);
  const zoomBy = (factor: number) =>
    setTransform((current) => ({
      ...current,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor)),
    }));
  const openViewer = () => {
    resetView();
    setIsExpanded(true);
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setTransform((current) => ({
      ...current,
      x: current.x + deltaX,
      y: current.y + deltaY,
    }));
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  async function handleReplaceWithIllustration() {
    if (
      !canReplaceWithIllustration ||
      replacing ||
      blockIndex === undefined ||
      !illustrationRegen
    ) {
      return;
    }
    setReplacing(true);
    setReplaceProgress(t("wizard.material.svgDiagram.generatingImage"));
    setReplaceError(null);
    try {
      const done = await consumeSsePost(
        `/api/units/${illustrationRegen.unitId}/components/${
          blockIndex + (illustrationRegen.blockOffset ?? 0)
        }/replace-with-illustration/stream`,
        {},
        (event) => {
          if (event.type !== "image_generation_progress") return;
          setReplaceProgress(event.message);
        },
      );
      const response = done as { component?: InteractiveBlock } | null;
      if (response?.component?.type !== "illustration") {
        throw new Error(t("wizard.material.svgDiagram.replaceWithImageFailed"));
      }
      illustrationRegen.onBlockRegenerated?.(blockIndex, response.component);
    } catch (cause) {
      setReplaceError(
        cause instanceof Error
          ? cause.message
          : t("wizard.material.svgDiagram.replaceWithImageFailed"),
      );
    } finally {
      setReplacing(false);
      setReplaceProgress("");
    }
  }

  return (
    <MaterialVisualFrame
      title={block.title}
      caption={block.caption}
      compact={compact}
      actions={
        canReplaceWithIllustration ? (
          <button
            type="button"
            onClick={() => void handleReplaceWithIllustration()}
            disabled={replacing}
            title={t("wizard.material.svgDiagram.replaceWithImage")}
            aria-label={t("wizard.material.svgDiagram.replaceWithImage")}
            className="inline-flex size-10 items-center justify-center rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)]/90 text-[var(--course-content-muted)] shadow-sm transition hover:text-[var(--course-content)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ImageIcon
              className={cn("size-4.5", replacing && "animate-pulse")}
              aria-hidden
            />
          </button>
        ) : null
      }
      expanded={isExpanded}
      fullscreenLabel={t("wizard.material.svgDiagram.fullscreen")}
      fullscreenHint={t("wizard.material.svgDiagram.rotateHint")}
      onExpandedChange={setIsExpanded}
      onOpenFullscreen={openViewer}
      expandedContent={
        <div
          className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden bg-[var(--course-content-surface-muted)]/45 p-3 sm:p-6"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onWheel={(event) => {
            event.preventDefault();
            zoomBy(event.deltaY > 0 ? 1 / 1.15 : 1.15);
          }}
        >
          <div
            className="flex h-full w-full items-center justify-center will-change-transform"
            style={{
              transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            }}
          >
            <CourseSvgMarkup
              alt={block.alt}
              className={`${themeClass} flex h-full w-full items-center justify-center overflow-visible [&>svg]:block [&>svg]:h-full [&>svg]:w-full [&>svg]:max-h-full [&>svg]:overflow-visible`}
              svg={block.svg}
            />
          </div>
        </div>
      }
      expandedToolbar={
        <MaterialVisualToolbar
          label={t("wizard.material.svgDiagram.viewTools")}
        >
          <MaterialVisualToolbarButton
            type="button"
            onClick={() => zoomBy(1 / 1.25)}
            disabled={transform.scale <= MIN_SCALE}
            className="inline-flex size-10 items-center justify-center rounded-xl hover:bg-muted disabled:opacity-35"
            aria-label={t("wizard.material.mathScene.zoomOut")}
          >
            <ZoomOut className="size-5" aria-hidden />
          </MaterialVisualToolbarButton>
          <div className="inline-flex h-10 min-w-16 items-center justify-center gap-1.5 px-2 text-sm font-medium tabular-nums">
            <Hand className="size-4" aria-hidden />
            {Math.round(transform.scale * 100)}%
          </div>
          <MaterialVisualToolbarButton
            type="button"
            onClick={() => zoomBy(1.25)}
            disabled={transform.scale >= MAX_SCALE}
            className="inline-flex size-10 items-center justify-center rounded-xl hover:bg-muted disabled:opacity-35"
            aria-label={t("wizard.material.mathScene.zoomIn")}
          >
            <ZoomIn className="size-5" aria-hidden />
          </MaterialVisualToolbarButton>
          <MaterialVisualToolbarButton
            type="button"
            onClick={resetView}
            disabled={
              transform.scale === 1 && transform.x === 0 && transform.y === 0
            }
            className="inline-flex size-10 items-center justify-center rounded-xl hover:bg-muted disabled:opacity-35"
            aria-label={t("wizard.material.mathScene.resetView")}
          >
            <RotateCcw className="size-4.5" aria-hidden />
          </MaterialVisualToolbarButton>
        </MaterialVisualToolbar>
      }
    >
      <CourseSvgMarkup
        alt={block.alt}
        className={`${themeClass} mx-auto w-full max-w-3xl overflow-visible [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[32rem] [&>svg]:w-full [&>svg]:overflow-visible`}
        svg={block.svg}
      />
      {replacing ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[var(--course-content-surface)]/70 text-xs text-[var(--course-content-muted)]">
          {replaceProgress || t("wizard.material.svgDiagram.generatingImage")}
        </div>
      ) : null}
      {replaceError ? (
        <p className="mt-2 text-xs text-destructive">{replaceError}</p>
      ) : null}
    </MaterialVisualFrame>
  );
}
