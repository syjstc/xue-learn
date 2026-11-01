"use client";
import { useT } from "@xue-learn/core/i18n";

import { HighlightableTextRegion } from "@/components/markdown/highlightable-text-region";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import { Button } from "@xue-learn/core/ui/button";
import { useMaterialPresentation } from "@/hooks/use-material-presentation";
import { useMaterialTextSelection } from "@/hooks/use-material-text-selection";
import { scrollFollowUpAnchorIntoView } from "@/shared/dom/follow-up-anchor-rect";
import { scrollSlideContentToTop } from "@/shared/dom/scroll-slide-content";
import {
  anchorId,
  resolveBlockIndex,
  type MaterialAnchor,
} from "@xue-learn/core/shared/domain/material-anchor";
import type { MaterialPresentationState } from "@/shared/domain/material-presentation";
import {
  buildMaterialSlideToc,
  buildMaterialSlides,
  repairHeadingOnlySectionTakeaways,
  slideLabel,
  type MaterialSlide,
  type MaterialSlideTocEntry,
} from "@/shared/domain/material-slides";
import type { LearningMaterialContent } from "@xue-learn/core/schemas";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import { cn } from "@xue-learn/core/utils";
import {
  ChevronLeft,
  ChevronRight,
  ListTree,
  Presentation,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SelectionFollowUpToolbar } from "./inline-follow-up-popup.tsx";
import {
  InteractiveMaterialBody,
  MaterialBlockRenderer,
  type IllustrationRegenHandlers,
  type MaterialCheckResult,
  type MaterialFollowUpHandlers,
  type VerifiedMaterialAnswerHandler,
} from "./interactive-material-body.tsx";
import { MaterialIntroductionBlock } from "./material-introduction.tsx";

type MaterialSlideDeckProps = {
  unitId: string;
  material: LearningMaterialContent;
  contextSources?: ContentSource[];
  compact?: boolean;
  followUp?: MaterialFollowUpHandlers;
  revealAnchor?: MaterialAnchor | null;
  revealAnchorNonce?: number;
  illustrationRegen?: IllustrationRegenHandlers;
  /** Called when the user finishes the last slide (including repeat visits). */
  onSlidesCompleted?: () => void;
  initialPresentation?: MaterialPresentationState | null | undefined;
  onPresentationActivity?: (state: {
    slideIndex: number;
    hasCompletedSlides: boolean;
  }) => void;
  tocFooter?: ReactNode;
  onVerifiedAnswer?: VerifiedMaterialAnswerHandler;
  materialCheckResults?: MaterialCheckResult[];
};

export function MaterialSlideDeck({
  unitId,
  material,
  contextSources = [],
  compact = false,
  followUp,
  revealAnchor,
  revealAnchorNonce = 0,
  illustrationRegen,
  onSlidesCompleted,
  initialPresentation,
  onPresentationActivity,
  tocFooter,
  onVerifiedAnswer,
  materialCheckResults = [],
}: MaterialSlideDeckProps) {
  const displayMaterial = useMemo(
    () => repairHeadingOnlySectionTakeaways(material),
    [material],
  );
  const slides = useMemo(() => buildMaterialSlides(material), [material]);
  const pres = useMaterialPresentation(
    unitId,
    slides.length,
    initialPresentation,
    onPresentationActivity,
  );
  const { hydrated, setSlideIndex } = pres;

  useEffect(() => {
    if (!hydrated || !revealAnchor) return;
    const blockIndex = resolveBlockIndex(displayMaterial, revealAnchor);
    if (blockIndex != null) {
      const targetSlideIndex = slides.findIndex(
        (slide) =>
          slide.kind === "section" && slide.blockIndices.includes(blockIndex),
      );
      if (targetSlideIndex >= 0) {
        setSlideIndex(targetSlideIndex);
      }
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollFollowUpAnchorIntoView(
          revealAnchor,
          anchorId(revealAnchor),
          displayMaterial,
        );
      });
    });
  }, [
    displayMaterial,
    hydrated,
    revealAnchor,
    revealAnchorNonce,
    setSlideIndex,
    slides,
  ]);

  if (!pres.hydrated) {
    return (
      <div
        className={`animate-pulse rounded-lg bg-muted ${compact ? "h-40" : "h-56"}`}
        aria-hidden
      />
    );
  }

  return (
    <SlidePresentation
      material={displayMaterial}
      slides={slides}
      contextSources={contextSources}
      compact={compact}
      followUp={followUp}
      illustrationRegen={illustrationRegen}
      onSlidesCompleted={onSlidesCompleted}
      pres={pres}
      tocFooter={tocFooter}
      onVerifiedAnswer={onVerifiedAnswer}
      materialCheckResults={materialCheckResults}
    />
  );
}

function PresentationToolbar({
  compact,
  hasCompletedSlides,
  slideIndex,
  slideCount,
}: {
  compact?: boolean;
  hasCompletedSlides: boolean;
  slideIndex: number;
  slideCount: number;
}) {
  const t = useT();
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--course-content-surface-accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--course-content-link)]">
        <Presentation className="h-3.5 w-3.5" />
        {t("desktop.ui.materialSlideDeck.lessonSlides")}
      </span>
      {slideCount > 0 && (
        <span className="text-muted-foreground">
          {slideIndex + 1} / {slideCount}
        </span>
      )}
      {hasCompletedSlides && (
        <span className="text-[10px] text-[var(--success)]">
          {t("desktop.ui.materialSlideDeck.completedPracticeAgainAnytime")}
        </span>
      )}
    </div>
  );
}

function SlidePresentation({
  material,
  slides,
  contextSources = [],
  compact,
  followUp,
  illustrationRegen,
  onSlidesCompleted,
  pres,
  tocFooter,
  onVerifiedAnswer,
  materialCheckResults,
}: {
  material: LearningMaterialContent;
  slides: MaterialSlide[];
  contextSources?: ContentSource[];
  compact?: boolean;
  followUp?: MaterialFollowUpHandlers;
  illustrationRegen?: IllustrationRegenHandlers;
  onSlidesCompleted?: () => void;
  pres: ReturnType<typeof useMaterialPresentation>;
  tocFooter?: ReactNode;
  onVerifiedAnswer?: VerifiedMaterialAnswerHandler;
  materialCheckResults: MaterialCheckResult[];
}) {
  const t = useT();
  const slide = slides[pres.slideIndex];
  const isLast = pres.slideIndex >= slides.length - 1;
  const [tocOpen, setTocOpen] = useState(false);
  const slideContentTopRef = useRef<HTMLDivElement>(null);
  const slideCardRef = useRef<HTMLDivElement>(null);
  const prevSlideIndexRef = useRef(pres.slideIndex);

  const tocEntries = useMemo(() => buildMaterialSlideToc(slides), [slides]);
  const selection = useMaterialTextSelection(material, followUp);

  const slideKey = slide
    ? `${slide.kind}-${slide.kind === "section" ? slide.sectionIndex : pres.slideIndex}`
    : pres.slideIndex;

  useEffect(() => {
    if (prevSlideIndexRef.current === pres.slideIndex) return;
    prevSlideIndexRef.current = pres.slideIndex;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollSlideContentToTop(
          slideCardRef.current,
          slideContentTopRef.current,
        );
      });
    });
  }, [pres.slideIndex]);

  const handleNext = useCallback(() => {
    if (isLast) {
      pres.markSlidesCompleted();
      onSlidesCompleted?.();
      return;
    }
    pres.goNext();
  }, [isLast, onSlidesCompleted, pres]);

  const handlePrev = useCallback(() => {
    pres.goPrev();
  }, [pres]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNext, handlePrev]);

  if (slides.length === 0) {
    return (
      <div>
        <div className="min-w-0 flex-1">
          <InteractiveMaterialBody
            material={material}
            contextSources={contextSources}
            compact={compact}
            followUp={followUp}
            illustrationRegen={illustrationRegen}
            onVerifiedAnswer={onVerifiedAnswer}
            materialCheckResults={materialCheckResults}
          />
        </div>
      </div>
    );
  }

  const progress = ((pres.slideIndex + 1) / slides.length) * 100;
  const highlights = followUp?.textHighlights ?? new Map();

  return (
    <div
      ref={selection.containerRef}
      data-material-slide-deck
      className={`relative min-w-0 ${compact ? "space-y-2" : "space-y-4"}`}
      onMouseUp={selection.handleMouseUp}
    >
      {/* <PresentationToolbar
        compact={compact}
        hasCompletedSlides={pres.hasCompletedSlides}
        slideIndex={pres.slideIndex}
        slideCount={slides.length}
      /> */}

      <div className="flex min-w-0 flex-col gap-3">
        <SlideTableOfContents
          entries={tocEntries}
          currentIndex={pres.slideIndex}
          compact={compact}
          open={tocOpen}
          onOpenChange={setTocOpen}
          footer={tocFooter}
          onNavigate={(index) => {
            pres.setSlideIndex(index);
            setTocOpen(false);
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div
            ref={slideCardRef}
            data-slide-card
            className={`scroll-mt-16 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--course-content-border)] bg-[var(--surface-elevated)] shadow-sm ${compact ? "min-h-[14rem]" : "min-h-[20rem]"}`}
          >
            {/* Progress bar */}
            <div className="h-1 bg-[var(--course-content-surface-muted)]">
              <div
                className="h-full rounded-r-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={pres.slideIndex + 1}
                aria-valuemin={1}
                aria-valuemax={slides.length}
              />
            </div>

            <div
              key={slideKey}
              className={`flex min-h-0 flex-1 flex-col ${compact ? "p-3" : "p-5 md:p-8"}`}
            >
              <div
                ref={slideContentTopRef}
                data-slide-content-top
                className="flex min-h-0 flex-1 flex-col"
              >
                {slide?.kind !== "intro" && (
                  <div className="mb-4">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--course-content-link)]">
                      {slide ? slideLabel(slide, pres.slideIndex) : ""}
                    </p>
                  </div>
                )}

                {slide?.kind === "intro" && (
                  <MaterialIntroductionBlock
                    compact={compact}
                    className={cn("flex-1")}
                  >
                    {
                      <HighlightableTextRegion
                        contentKey="intro"
                        text={slide.text}
                        spans={highlights.get("intro")}
                        highlightSpansByKey={highlights}
                        sources={contextSources}
                        onSpanClick={followUp?.onHighlightClick}
                      />
                    }
                  </MaterialIntroductionBlock>
                )}

                {slide?.kind === "section" && (
                  <div
                    data-slide-scroll
                    className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
                  >
                    {slide.blockIndices.map((blockIndex) => (
                      <div
                        key={blockIndex}
                        data-block-index={blockIndex}
                        className={cn()}
                      >
                        {
                          <MaterialBlockRenderer
                            block={material.blocks[blockIndex]}
                            blockIndex={blockIndex}
                            compact={compact}
                            followUp={followUp}
                            highlights={highlights}
                            sources={contextSources}
                            illustrationRegen={illustrationRegen}
                            onVerifiedAnswer={onVerifiedAnswer}
                            materialCheckResult={materialCheckResults.find(
                              (result) =>
                                result.checkId ===
                                (material.blocks[blockIndex].type === "check"
                                  ? material.blocks[blockIndex].checkId
                                  : undefined),
                            )}
                          />
                        }
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-[var(--course-content-border)] pt-4">
                {isLast && pres.hasCompletedSlides && (
                  <p className="mb-2 text-center text-xs text-[var(--success)]">
                    {t(
                      "desktop.ui.materialSlideDeck.youHaveFinishedTheLessonContinueBelow",
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handlePrev}
                    disabled={pres.slideIndex === 0}
                    aria-label={t("desktop.errorLogs.previous")}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t("desktop.errorLogs.previous")}
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={handleNext}
                    aria-label={
                      isLast
                        ? t("desktop.ui.materialSlideDeck.finishLesson")
                        : t("desktop.errorLogs.next")
                    }
                  >
                    {isLast ? (
                      <>
                        <Sparkles className="mr-1 h-4 w-4" />
                        {t("desktop.ui.materialSlideDeck.finishLesson")}
                      </>
                    ) : (
                      <>
                        {t("desktop.errorLogs.next")}
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* {pres.hasCompletedSlides && (
        <p className="text-center text-[11px] text-muted-foreground">
          你已完成过一次幻灯片学习，可随时通过目录跳转复习，或继续多次练习。
        </p>
      )} */}

      {selection.selectionToolbar && followUp && (
        <SelectionFollowUpToolbar
          getAnchorRect={selection.getSelectionToolbarRect}
          onAsk={() => {
            const rect = selection.getSelectionToolbarRect();
            followUp.onOpenFollowUp(selection.selectionToolbar!.anchor, {
              rect: rect ?? undefined,
              blockIndex: selection.selectionToolbar!.anchor.blockIndex,
              newThread: true,
            });
            selection.clearSelection();
          }}
          onDismiss={selection.clearSelection}
        />
      )}
    </div>
  );
}

function SlideTableOfContents({
  entries,
  currentIndex,
  compact,
  open,
  onOpenChange,
  onNavigate,
  footer,
}: {
  entries: MaterialSlideTocEntry[];
  currentIndex: number;
  compact?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (slideIndex: number) => void;
  footer?: ReactNode;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      activeItemRef.current?.scrollIntoView({ block: "nearest" });
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (entries.length <= 1) return null;

  const textSize = compact ? "text-[11px]" : "text-xs";

  const list = (
    <nav
      aria-label={t("desktop.ui.materialSlideDeck.slideOutline")}
      className="space-y-0.5"
    >
      {entries.map((entry) => {
        const active = entry.slideIndex === currentIndex;
        return (
          <button
            key={entry.slideIndex}
            ref={active ? activeItemRef : undefined}
            type="button"
            onClick={() => onNavigate(entry.slideIndex)}
            className={`w-full rounded-md px-2.5 py-1.5 text-left transition-colors inline-flex items-baseline ${
              active
                ? "bg-[var(--course-content-surface-accent)] font-medium text-[var(--course-content-link)]"
                : "text-[var(--course-content-muted)] hover:bg-[var(--course-content-surface-muted)] hover:text-[var(--course-content)]"
            } ${textSize}`}
            aria-current={active ? "location" : undefined}
          >
            <span className="mr-1.5 tabular-nums text-[var(--course-content-muted)]">
              {entry.slideIndex + 1}.
            </span>
            <LlmMarkdownInline content={entry.label} />
          </button>
        );
      })}
    </nav>
  );

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="slide-toc-panel"
      >
        <ListTree className="mr-1 h-3.5 w-3.5" />
        {t("desktop.ui.materialSlideDeck.contents")}
      </Button>
      {open && (
        <div
          id="slide-toc-panel"
          className="absolute left-0 top-full z-20 mt-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-[var(--course-content-border)] bg-popover p-2 shadow-lg"
        >
          {list}
          {footer}
        </div>
      )}
    </div>
  );
}
