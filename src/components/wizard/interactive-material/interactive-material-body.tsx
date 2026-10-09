"use client";

import { MarkdownContent } from "@/components/ui/markdown-content";
import { courseDiscussionTurn } from "@/shared/domain/course-discussion-placement";
import type { CourseBoardPlayback } from "@/components/course-display/course-chat-board";
import { CourseConversationLayout } from "@/components/course-display/course-conversation-layout";
import { resolveAssistantCourseDisplay } from "@/shared/domain/assistant-course-display";

import {
  ASSISTANT_TYPEWRITER_CHARS_PER_TICK,
  ASSISTANT_TYPEWRITER_MS_PER_TICK,
  AssistantChatMessage,
} from "@/components/wizard/conversation/assistant-chat-message";
import { TopicRegenButton } from "@/components/wizard/unit-sections/topic-regen-button";
import {
  useMaterialTextSelection,
  type MaterialFollowUpHandlers,
} from "@/hooks/use-material-text-selection";
import {
  buildAssistantCourseFeed,
  type AssistantCourseFeedBlock,
} from "@/shared/domain/assistant-course-feed";
import { personalizeLearnerContent } from "@/shared/domain/learner-text";
import { anchorForBlock, anchorId } from "@xue-learn/core/source/src/shared/domain/material-anchor.ts";
import type { TextHighlightSpan } from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import { comboCueTargetIds } from "@/shared/domain/material-live-cue";
import { repairHeadingOnlySectionTakeaways } from "@/shared/domain/material-slides";
import { headingTopicIdentity } from "@/shared/domain/material-topic-identity";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import type {
  InteractiveBlock,
  LearningMaterialContent,
} from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import {
  figureCaptionsForDisplay,
  type MaterialFigureCaption,
} from "@xue-learn/core/source/libs/domain/src/index.ts";
import { BookOpenCheck, ListChecks } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SelectionFollowUpToolbar } from "../inline-follow-up-popup.tsx";
import { MaterialIntroductionBlock } from "../material-introduction.tsx";
import { MaterialBlockRenderer } from "./material-block-renderer.tsx";
import { Selectable } from "./selectable.tsx";
import type {
  IllustrationRegenHandlers,
  MaterialCheckResult,
  VerifiedMaterialAnswerHandler,
} from "./types.ts";

const COMPLEX_COMPONENT_TYPES = new Set([
  "step_sort",
  "graph",
  "chart",
  "math_scene",
]);

export type AssistantFeedPresentation = {
  controls?: ReactNode;
  firstVisibleTurnIndex?: number;
  visibleTurnCount: number;
  stagedOpeningTurnIndex?: number;
  animatedTurnIndex?: number;
  preparingTurnIndex?: number;
  reservedTurnIndex?: number;
  reservedTurnMinHeight?: number;
  animationEnabled?: boolean;
  textAnimationEnabled?: boolean;
  persona: {
    name: string;
    avatarSrc: string;
  };
  onAnimationComplete?: () => void;
  timedReveal?: {
    contentKey: string;
    revealedLength: number;
    onSkip: () => void;
  };
  renderNarrationAudioControl?: (contentKey: string, text: string) => ReactNode;
};

function blockSignature(block: InteractiveBlock): string {
  return JSON.stringify(block);
}

export function InteractiveMaterialBody({
  material,
  contextSources = [],
  compact = false,
  revealAnswers = false,
  followUp,
  illustrationRegen,
  emphasizeContentKey,
  sourceHighlights,
  onVerifiedAnswer,
  materialCheckResults = [],
  complexComponentAnchors = [],
  deferredSubmit = false,
  assistantFeed,
  onRegenerateTopic,
  regeneratingTopicIndex,
}: {
  material: LearningMaterialContent;
  contextSources?: ContentSource[];
  compact?: boolean;
  /** Reference mode: show correct answers and explanations without quizzing. */
  revealAnswers?: boolean;
  deferredSubmit?: boolean;
  followUp?: MaterialFollowUpHandlers;
  illustrationRegen?: IllustrationRegenHandlers;
  /** Whole-region emphasis (e.g. flashcard source anchor). */
  emphasizeContentKey?: string;
  sourceHighlights?: Map<string, TextHighlightSpan[]>;
  onVerifiedAnswer?: VerifiedMaterialAnswerHandler;
  materialCheckResults?: MaterialCheckResult[];
  /** Ordered virtual-component anchors; these do not create material blocks. */
  complexComponentAnchors?: string[];
  assistantFeed?: AssistantFeedPresentation;
  onRegenerateTopic?: (input: { topicId?: string; topicIndex: number }) => void;
  regeneratingTopicIndex?: number | null;
}) {
  const t = useT();
  const displayMaterial = useMemo(() => {
    return personalizeLearnerContent(
      repairHeadingOnlySectionTakeaways(material),
    );
  }, [material]);
  const textClass = compact ? "text-sm" : "text-base";
  const baseHighlights = followUp?.textHighlights ?? new Map();
  const highlights = useMemo(() => {
    if (!sourceHighlights || sourceHighlights.size === 0) return baseHighlights;
    const merged = new Map(baseHighlights);
    for (const [key, spans] of sourceHighlights) {
      merged.set(key, [...(merged.get(key) ?? []), ...spans]);
    }
    return merged;
  }, [baseHighlights, sourceHighlights]);
  const {
    containerRef,
    selectionToolbar,
    clearSelection,
    handleMouseUp,
    getSelectionToolbarRect,
  } = useMaterialTextSelection(material, followUp);

  const emphasizeRingClass =
    "rounded-lg ring-2 ring-[var(--course-content-attention-border)] ring-offset-1 bg-[var(--course-content-highlight-bg)]";
  const previousBlockSignaturesRef = useRef<string[] | null>(null);
  const [messageReplay, setMessageReplay] = useState<{
    turnIndex: number;
    cursor: number;
    first: number;
    nonce: number;
  } | null>(null);
  const [refreshedBlockIndices, setRefreshedBlockIndices] = useState<
    Set<number>
  >(() => new Set());
  const [revealedStagedTurnIndex, setRevealedStagedTurnIndex] = useState<
    number | null
  >(null);
  const [
    revealedStagedFollowingTurnsIndex,
    setRevealedStagedFollowingTurnsIndex,
  ] = useState<number | null>(null);
  const assistantTurns = useMemo(
    () => buildAssistantCourseFeed(displayMaterial),
    [displayMaterial],
  );

  useEffect(() => {
    const stagedTurnIndex = assistantFeed?.stagedOpeningTurnIndex;
    if (stagedTurnIndex == null) {
      setRevealedStagedTurnIndex(null);
      setRevealedStagedFollowingTurnsIndex(null);
      return;
    }

    setRevealedStagedTurnIndex(null);
    setRevealedStagedFollowingTurnsIndex(null);
    const firstContentTimer = window.setTimeout(
      () => setRevealedStagedTurnIndex(stagedTurnIndex),
      800,
    );
    const followingTurnsTimer = window.setTimeout(
      () => setRevealedStagedFollowingTurnsIndex(stagedTurnIndex),
      1140,
    );
    return () => {
      window.clearTimeout(firstContentTimer);
      window.clearTimeout(followingTurnsTimer);
    };
  }, [assistantFeed?.stagedOpeningTurnIndex]);
  const componentAnchorByBlockIndex = useMemo(() => {
    const anchors = new Map<number, string>();
    let componentIndex = 0;
    displayMaterial.blocks.forEach((block, blockIndex) => {
      if (!COMPLEX_COMPONENT_TYPES.has(block.type)) return;
      const anchor = complexComponentAnchors[componentIndex];
      if (anchor) anchors.set(blockIndex, anchor);
      componentIndex += 1;
    });
    return anchors;
  }, [complexComponentAnchors, displayMaterial.blocks]);

  useEffect(() => {
    const signatures = material.blocks.map(blockSignature);
    const previous = previousBlockSignaturesRef.current;
    previousBlockSignaturesRef.current = signatures;
    if (!previous) return;

    const changed = signatures
      .map((signature, index) =>
        previous[index] && previous[index] !== signature ? index : -1,
      )
      .filter(
        (index) => index >= 0 && material.blocks[index]?.type !== "placeholder",
      );
    if (changed.length === 0) return;

    setRefreshedBlockIndices(new Set(changed));
    const timer = window.setTimeout(() => {
      setRefreshedBlockIndices(new Set());
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [material.blocks]);

  const checkBlockClass = (blockIndex: number) => {
    if (emphasizeContentKey === `block:${blockIndex}`)
      return emphasizeRingClass;
    if (!followUp?.blockThreadIds.has(blockIndex)) return "";
    const block = material.blocks[blockIndex];
    if (block?.type !== "check") return "";
    const aid = anchorId(anchorForBlock(block, blockIndex, "check.wrong"));
    const active = followUp.activeAnchorId === aid;
    return active
      ? "rounded-lg ring-2 ring-[var(--course-content-attention-border)] ring-offset-1"
      : "rounded-lg ring-1 ring-[var(--course-content-attention-border)]";
  };

  const topicRegenForHeading = (blockIndex: number) => {
    if (compact || revealAnswers || !onRegenerateTopic) {
      return {
        onRegenerateTopic: undefined,
        regeneratingTopic: false,
      };
    }
    const identity = headingTopicIdentity(displayMaterial.blocks, blockIndex);
    if (!identity) {
      return {
        onRegenerateTopic: undefined,
        regeneratingTopic: false,
      };
    }
    return {
      onRegenerateTopic: () => onRegenerateTopic(identity),
      regeneratingTopic: identity.topicIndex === regeneratingTopicIndex,
    };
  };

  const renderMaterialBlock = (
    entry: AssistantCourseFeedBlock,
    extraClassName?: string,
    activeTargetIds: readonly string[] = [],
    figureCaptions: readonly MaterialFigureCaption[] = [],
    boardPlayback?: CourseBoardPlayback,
  ) => {
    const { block, blockIndex } = entry;
    return (
      <div
        key={blockIndex}
        id={componentAnchorByBlockIndex.get(blockIndex)}
        data-block-index={blockIndex}
        className={cn(
          extraClassName,
          checkBlockClass(blockIndex),
          componentAnchorByBlockIndex.has(blockIndex) && "scroll-mt-24",
          refreshedBlockIndices.has(blockIndex) && "material-block-refresh",
        )}
      >
        {
          <>
            <MaterialBlockRenderer
              block={block}
              blockIndex={blockIndex}
              compact={compact}
              revealAnswers={revealAnswers}
              deferredSubmit={deferredSubmit}
              followUp={followUp}
              highlights={highlights}
              sources={contextSources}
              illustrationRegen={illustrationRegen}
              activeTargetIds={activeTargetIds}
              figureCaptions={figureCaptions}
              guided
              boardPlayback={boardPlayback}
              onVerifiedAnswer={onVerifiedAnswer}
              materialCheckResult={materialCheckResults.find(
                (result) =>
                  result.checkId ===
                  (block.type === "check" ? block.checkId : undefined),
              )}
              {...topicRegenForHeading(blockIndex)}
            />
          </>
        }
      </div>
    );
  };

  const renderAssistantTransition = (
    entry: AssistantCourseFeedBlock,
    animate = false,
  ) => {
    if (entry.block.type !== "heading") {
      return renderMaterialBlock(entry);
    }

    const topicRegen = topicRegenForHeading(entry.blockIndex);
    return (
      <div
        key={entry.blockIndex}
        data-block-index={entry.blockIndex}
        data-assistant-transition
        className={cn(
          "relative flex w-full min-w-0 flex-wrap items-start justify-between gap-2 py-3 text-[var(--course-content-muted)] sm:py-4",
          animate &&
            "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500",
        )}
        aria-label={entry.block.text}
      >
        <h3
          className={cn(
            "min-w-0 flex-1 basis-40 text-lg font-semibold leading-7 text-[var(--course-content)] sm:text-xl sm:leading-8",
            animate &&
              "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-500",
          )}
        >
          <Selectable
            contentKey={`block:${entry.blockIndex}`}
            text={entry.block.text}
            highlights={highlights}
            sources={contextSources}
            followUp={followUp}
            markdownVariant="inline"
          />
        </h3>
        {topicRegen.onRegenerateTopic ? (
          <TopicRegenButton
            busy={topicRegen.regeneratingTopic}
            onClick={topicRegen.onRegenerateTopic}
          />
        ) : null}
      </div>
    );
  };

  const renderAssistantFeed = () => {
    const firstVisibleTurnIndex = Math.max(
      0,
      Math.min(
        assistantTurns.length,
        assistantFeed?.firstVisibleTurnIndex ?? 0,
      ),
    );
    const visibleTurnCount = Math.max(
      firstVisibleTurnIndex,
      Math.min(assistantTurns.length, assistantFeed?.visibleTurnCount ?? 0),
    );
    const visibleTurns = assistantTurns
      .map((turn, turnIndex) => ({ turn, turnIndex }))
      .slice(firstVisibleTurnIndex, visibleTurnCount);
    const renderAssistantAvatar = (className?: string) => (
      <img
        src={assistantFeed!.persona.avatarSrc}
        alt=""
        className={cn(
          "size-8 rounded-full object-cover ring-1 ring-[var(--course-content-border)] sm:size-9 md:size-10",
          className,
        )}
      />
    );
    const assistantMessageClass =
      "relative min-w-0 max-w-[42rem] rounded-[1.125rem] rounded-tl-sm px-4 py-3 transition-colors motion-reduce:transition-none sm:px-5 sm:py-3.5";
    const assistantMessageRowClass =
      "grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2.5 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-x-3 md:grid-cols-[2.5rem_minmax(0,1fr)]";
    const presentation = resolveAssistantCourseDisplay(
      displayMaterial,
      assistantTurns,
      firstVisibleTurnIndex,
      visibleTurnCount,
    );
    const replay =
      messageReplay?.cursor === visibleTurnCount &&
      messageReplay.first === firstVisibleTurnIndex
        ? messageReplay
        : null;
    const focusedTurnIndex = replay?.turnIndex ?? visibleTurnCount - 1;
    const focusedPresentation = replay
      ? resolveAssistantCourseDisplay(
          displayMaterial,
          assistantTurns,
          firstVisibleTurnIndex,
          focusedTurnIndex + 1,
        )
      : presentation;
    const liveCue = {
      displayIndex: focusedPresentation.display?.blockIndex,
      targetIds: focusedPresentation.activeTargetIds,
    };
    const boardPlayback = {
      key: replay ? `replay:${replay.nonce}` : `turn:${visibleTurnCount}`,
      animate: Boolean(
        replay ||
        assistantFeed?.animationEnabled ||
        assistantFeed?.preparingTurnIndex != null,
      ),
    };
    const replayMessage = (turnIndex: number) =>
      setMessageReplay({
        turnIndex,
        cursor: visibleTurnCount,
        first: firstVisibleTurnIndex,
        nonce: performance.now(),
      });
    const renderedTurns = new Map(
      visibleTurns.map(({ turn, turnIndex }) => [
        turnIndex,
        (() => {
          const stagedOpeningTurnIndex = assistantFeed?.stagedOpeningTurnIndex;
          if (
            stagedOpeningTurnIndex != null &&
            turnIndex > stagedOpeningTurnIndex &&
            revealedStagedFollowingTurnsIndex !== stagedOpeningTurnIndex
          ) {
            return null;
          }
          const showAvatar = false;
          const showName = false;
          const currentVisible = turnIndex === visibleTurnCount - 1;
          const newest = turnIndex === assistantFeed?.animatedTurnIndex;
          const preparing = turnIndex === assistantFeed?.preparingTurnIndex;
          const reservesRevealSpace =
            assistantFeed?.reservedTurnMinHeight != null &&
            (newest ||
              preparing ||
              turnIndex === assistantFeed?.reservedTurnIndex);
          const animatingNewest =
            newest && Boolean(assistantFeed?.animationEnabled);
          const stagedPartOpening =
            turnIndex === assistantFeed?.stagedOpeningTurnIndex &&
            turn.dividers.some((entry) => entry.block.type === "heading");
          const stagedPartContentReady =
            !stagedPartOpening || revealedStagedTurnIndex === turnIndex;
          const transitionGateActive = false;
          const animateTurnContent = animatingNewest;
          const typingNewest =
            animateTurnContent && Boolean(assistantFeed?.textAnimationEnabled);
          if (turn.kind === "summary") {
            return (
              <section
                key={`summary:${turnIndex}`}
                data-assistant-turn-index={turnIndex}
                className={cn(
                  "scroll-mt-32",
                  preparing && "pointer-events-none opacity-0",
                  animateTurnContent &&
                    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-700",
                )}
                style={
                  reservesRevealSpace
                    ? { minHeight: assistantFeed?.reservedTurnMinHeight }
                    : undefined
                }
                aria-hidden={preparing || undefined}
                onAnimationEnd={(event) => {
                  if (
                    animateTurnContent &&
                    event.target === event.currentTarget
                  ) {
                    assistantFeed?.onAnimationComplete?.();
                  }
                }}
              >
                {!transitionGateActive ? (
                  <div className={assistantMessageRowClass}>
                    {showAvatar ? (
                      renderAssistantAvatar()
                    ) : (
                      <span aria-hidden />
                    )}
                    <div className="min-w-0">
                      {showName ? (
                        <p className="mb-1 text-xs font-semibold text-[var(--course-content-muted)]">
                          {assistantFeed!.persona.name}
                        </p>
                      ) : null}
                      <div
                        className={cn(
                          assistantMessageClass,
                          currentVisible
                            ? "bg-[var(--course-content-surface-muted)]/75"
                            : "bg-[var(--course-content-surface-muted)]/30",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <BookOpenCheck
                            aria-hidden
                            className="size-5 text-[var(--course-content-link)]"
                          />
                          <h3 className="font-semibold text-[var(--course-content)]">
                            {t("wizard.material.takeawaysTitle")}
                          </h3>
                        </div>
                        <ol className="mt-4 space-y-3">
                          {turn.takeaways.map((takeaway, index) => (
                            <li
                              key={`${index}:${takeaway}`}
                              className={cn(
                                "flex gap-3 border-t border-[var(--course-content-border)] pt-3 first:border-0 first:pt-0",
                              )}
                            >
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--course-content-surface-accent)] text-xs font-semibold text-[var(--course-content-link)]">
                                {index + 1}
                              </span>
                              <Selectable
                                contentKey={`takeaway:${index}`}
                                text={takeaway}
                                highlights={highlights}
                                sources={contextSources}
                                followUp={followUp}
                              />
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          }
          if (turn.kind === "key_points") {
            return (
              <section
                key={`key-points:${turnIndex}`}
                data-assistant-turn-index={turnIndex}
                data-block-index={turn.blockIndex}
                className={cn(
                  "scroll-mt-32",
                  preparing && "pointer-events-none opacity-0",
                  animateTurnContent &&
                    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-700",
                )}
                style={
                  reservesRevealSpace
                    ? { minHeight: assistantFeed?.reservedTurnMinHeight }
                    : undefined
                }
                aria-hidden={preparing || undefined}
                onAnimationEnd={(event) => {
                  if (
                    animateTurnContent &&
                    event.target === event.currentTarget
                  ) {
                    assistantFeed?.onAnimationComplete?.();
                  }
                }}
              >
                {!transitionGateActive ? (
                  <div className={assistantMessageRowClass}>
                    {showAvatar ? (
                      renderAssistantAvatar()
                    ) : (
                      <span aria-hidden />
                    )}
                    <div className="min-w-0">
                      {showName ? (
                        <p className="mb-1 text-xs font-semibold text-[var(--course-content-muted)]">
                          {assistantFeed!.persona.name}
                        </p>
                      ) : null}
                      <div
                        className={cn(
                          assistantMessageClass,
                          currentVisible
                            ? "bg-[var(--course-content-surface-muted)]/75"
                            : "bg-[var(--course-content-surface-muted)]/30",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <ListChecks
                            aria-hidden
                            className="size-5 text-[var(--course-content-link)]"
                          />
                          <h3 className="font-semibold text-[var(--course-content)]">
                            {t("wizard.material.keyPointsTitle")}
                          </h3>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--course-content-muted)]">
                          {t("wizard.material.keyPointsDescription")}
                        </p>
                        <Selectable
                          contentKey={`block:${turn.blockIndex}`}
                          text={turn.text}
                          highlights={highlights}
                          sources={contextSources}
                          followUp={followUp}
                          className="mt-4 block"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
                <span
                  data-assistant-turn-end
                  className="block h-px w-px"
                  aria-hidden
                />
              </section>
            );
          }

          if (turn.kind === "display") {
            return (
              <section
                key={`display:${turn.display.blockIndex}`}
                data-assistant-turn-index={turnIndex}
                className={cn(
                  "scroll-mt-32",
                  preparing && "pointer-events-none opacity-0",
                  animateTurnContent &&
                    "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-700",
                )}
                style={
                  reservesRevealSpace
                    ? { minHeight: assistantFeed?.reservedTurnMinHeight }
                    : undefined
                }
                aria-hidden={preparing || undefined}
                onAnimationEnd={(event) => {
                  if (
                    animateTurnContent &&
                    event.target === event.currentTarget
                  ) {
                    assistantFeed?.onAnimationComplete?.();
                  }
                }}
              >
                {!transitionGateActive ? (
                  <div
                    data-learning-canvas
                    data-block-type={turn.display.block.type}
                    className={`mx-auto w-full min-w-0 py-1 ${turn.display.block.type === "stage" ? "" : "max-w-[48rem]"}`}
                  >
                    {renderMaterialBlock(
                      turn.display,
                      undefined,
                      liveCue.displayIndex === turn.display.blockIndex
                        ? liveCue.targetIds
                        : [],
                      [],
                      {
                        ...boardPlayback,
                        revealedTargetIds: focusedPresentation.revealedTargetIdsByBlock[turn.display.blockIndex],
                      },
                    )}
                  </div>
                ) : null}
                <span
                  data-assistant-turn-end
                  className="block h-px w-px"
                  aria-hidden
                />
              </section>
            );
          }

          const lastNarrationIndex = turn.narration.length - 1;
          return (
            <article
              key={`turn:${turnIndex}`}
              data-assistant-turn-index={turnIndex}
              className={cn(
                "scroll-mt-32 space-y-3",
                preparing && "pointer-events-none opacity-0",
                animateTurnContent &&
                  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-500",
              )}
              style={
                reservesRevealSpace
                  ? { minHeight: assistantFeed?.reservedTurnMinHeight }
                  : undefined
              }
              aria-hidden={preparing || undefined}
              onAnimationEnd={(event) => {
                if (
                  animateTurnContent &&
                  turn.narration.length === 0 &&
                  event.target === event.currentTarget
                ) {
                  assistantFeed?.onAnimationComplete?.();
                }
              }}
            >
              {!transitionGateActive &&
              stagedPartContentReady &&
              turn.narration.length > 0 ? (
                <AssistantChatMessage
                  avatarSrc={assistantFeed!.persona.avatarSrc}
                  name={assistantFeed!.persona.name}
                  showAvatar={showAvatar}
                  showName={showName}
                  current={currentVisible}
                  className={cn(
                    stagedPartOpening && "lesson-part-content-enter",
                  )}
                  bubbleClassName="space-y-3 text-base leading-7 text-[var(--course-content)]"
                >
                  {turn.narration.map((item, narrationIndex) => {
                    const contentKey =
                      item.kind === "introduction"
                        ? "intro"
                        : `block:${item.blockIndex}`;
                    const timedReveal =
                      assistantFeed?.timedReveal?.contentKey === contentKey
                        ? assistantFeed.timedReveal
                        : undefined;
                    const animated = typingNewest || Boolean(timedReveal);
                    const content = (
                      <Selectable
                        contentKey={contentKey}
                        text={item.text}
                        highlights={highlights}
                        sources={contextSources}
                        followUp={followUp}
                        animateText={animated}
                        typewriterResetKey={`${turnIndex}:${contentKey}`}
                        typewriterCharsPerTick={
                          ASSISTANT_TYPEWRITER_CHARS_PER_TICK
                        }
                        typewriterMsPerTick={ASSISTANT_TYPEWRITER_MS_PER_TICK}
                        onTextAnimationComplete={
                          typingNewest && narrationIndex === lastNarrationIndex
                            ? () => assistantFeed?.onAnimationComplete?.()
                            : undefined
                        }
                        revealedLength={timedReveal?.revealedLength}
                        onTypewriterSkip={timedReveal?.onSkip}
                      />
                    );
                    return item.kind === "paragraph" ? (
                      <div
                        key={contentKey}
                        data-block-index={item.blockIndex}
                        className={cn()}
                      >
                        {content}
                        {assistantFeed?.renderNarrationAudioControl?.(
                          contentKey,
                          item.text,
                        )}
                      </div>
                    ) : (
                      <div key={contentKey} className={cn()}>
                        {content}
                        {assistantFeed?.renderNarrationAudioControl?.(
                          contentKey,
                          item.text,
                        )}
                      </div>
                    );
                  })}
                </AssistantChatMessage>
              ) : null}

              <span
                data-assistant-turn-end
                className="block h-px w-px"
                aria-hidden
              />
            </article>
          );
        })(),
      ]),
    );
    const lastNarration = visibleTurns
      .filter(({ turn }) => turn.kind === "lesson")
      .at(-1)?.turn;
    const lastItem =
      lastNarration?.kind === "lesson"
        ? lastNarration.narration.at(-1)
        : undefined;
    const chatAnchor =
      lastItem?.kind === "paragraph"
        ? anchorForBlock(
            displayMaterial.blocks[lastItem.blockIndex],
            lastItem.blockIndex,
          )
        : { scope: "introduction" as const };
    const inlineChat = followUp?.inlineChat;
    const discussions = inlineChat?.discussions ?? [];
    const renderDiscussions = (turnIndex: number) =>
      discussions
        .filter(
          (thread) =>
            thread.messages.length &&
            courseDiscussionTurn(
              displayMaterial,
              assistantTurns,
              thread.anchor,
            ) === turnIndex,
        )
        .map((thread) => (
          <details
            key={thread.id}
            open
            className="course-conversation-discussion"
            data-course-discussion={thread.id}
            data-course-chat
          >
            <summary>
              {t("learningDisplay.discussion")} ·{" "}
              {thread.messages
                .find((message) => message.role === "user")
                ?.content.slice(0, 48)}
            </summary>
            <div className="course-conversation-chat">
              {thread.messages.map((message, index) => (
                <div
                  key={index}
                  className="course-conversation-reply"
                  data-role={message.role}
                >
                  {message.quotedText ? (
                    <blockquote>{message.quotedText}</blockquote>
                  ) : null}
                  <MarkdownContent
                    content={message.content || t("learningDisplay.thinking")}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={inlineChat?.sending}
              onClick={() => followUp?.onOpenFollowUp(thread.anchor)}
            >
              {t("learningDisplay.resumeDiscussion")}
            </button>
          </details>
        ));
    return (
      <CourseConversationLayout
        identity={focusedPresentation.key}
        topicIdentity={`topic:${presentation.topicStart}`}
        controls={assistantFeed?.controls}
        chat={
          followUp?.inlineChat
            ? {
                messages:
                  discussions.find(
                    (thread) => thread.id === inlineChat?.activeDiscussionId,
                  )?.messages ?? [],
                activeDiscussionId: inlineChat?.activeDiscussionId,
                sending: followUp.inlineChat.sending,
                error: followUp.inlineChat.error,
                onStop: followUp.inlineChat.stop,
                selection: followUp.inlineChat.selection,
                onClearSelection: followUp.inlineChat.clearSelection,
                onSend: (message) =>
                  followUp.inlineChat!.send(chatAnchor, message),
              }
            : undefined
        }
        heading={assistantTurns[presentation.topicStart]?.dividers.map(
          (entry) => renderAssistantTransition(entry),
        )}
        display={
          presentation.displayGroups.length
            ? presentation.displayGroups.map((group) => (
                <div
                  key={group.key}
                  data-course-display-key={group.key}
                  className="course-conversation-display-item"
                >
                  {renderedTurns.get(group.turnIndex)}
                </div>
              ))
            : undefined
        }
        persona={assistantFeed!.persona}
      >
        <div
          key={`topic:${presentation.topicStart}`}
          className="course-conversation-lesson"
        >
          {visibleTurns
            .filter(
              ({ turn, turnIndex }) =>
                turnIndex >= presentation.topicStart &&
                (turn.kind !== "display" ||
                  discussions.some(
                    (thread) =>
                      courseDiscussionTurn(
                        displayMaterial,
                        assistantTurns,
                        thread.anchor,
                      ) === turnIndex,
                  )),
            )
            .map(({ turnIndex }) => (
              <div
                key={turnIndex}
                data-course-narration-for={
                  presentation.displayGroups.find((group) =>
                    group.narrationTurnIndices.includes(turnIndex),
                  )?.key
                }
              >
                {assistantTurns[turnIndex].kind !== "display" ? (
                  <div
                    className="course-conversation-message"
                    data-active={focusedTurnIndex === turnIndex || undefined}
                    aria-current={focusedTurnIndex === turnIndex ? "step" : undefined}
                    onClick={(event) => {
                      if (
                        (event.target as Element).closest(
                          "button,a,input,textarea",
                        )
                      )
                        return;
                      if (!window.getSelection()?.isCollapsed) return;
                      replayMessage(turnIndex);
                    }}
                  >
                    <button
                      type="button"
                      className="course-message-replay"
                      onClick={() => replayMessage(turnIndex)}
                      aria-label={t("learningDisplay.replay")}
                      title={t("learningDisplay.replay")}
                    >
                      ↺
                    </button>
                    {renderedTurns.get(turnIndex)}
                  </div>
                ) : null}
                {renderDiscussions(turnIndex)}
              </div>
            ))}
        </div>
      </CourseConversationLayout>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`relative space-y-3 text-[var(--course-content)] ${textClass}`}
      onMouseUp={handleMouseUp}
    >
      {assistantFeed ? renderAssistantFeed() : null}
      {!assistantFeed && displayMaterial.introduction && (
        <MaterialIntroductionBlock
          compact={compact}
          emphasize={emphasizeContentKey === "intro"}
          className={cn()}
        >
          {
            <Selectable
              contentKey="intro"
              text={displayMaterial.introduction}
              highlights={highlights}
              sources={contextSources}
              followUp={followUp}
            />
          }
        </MaterialIntroductionBlock>
      )}
      {!assistantFeed &&
        displayMaterial.blocks.map((block, i) => (
          <div
            key={i}
            id={componentAnchorByBlockIndex.get(i)}
            data-block-index={i}
            className={cn(
              checkBlockClass(i),
              componentAnchorByBlockIndex.has(i) && "scroll-mt-24",
              refreshedBlockIndices.has(i) && "material-block-refresh",
            )}
          >
            {
              <>
                <MaterialBlockRenderer
                  block={block}
                  blockIndex={i}
                  compact={compact}
                  revealAnswers={revealAnswers}
                  deferredSubmit={deferredSubmit}
                  followUp={followUp}
                  highlights={highlights}
                  sources={contextSources}
                  illustrationRegen={illustrationRegen}
                  activeTargetIds={comboCueTargetIds(displayMaterial.blocks, i)}
                  figureCaptions={
                    block.type === "heading" ||
                    block.type === "paragraph" ||
                    block.type === "check"
                      ? []
                      : figureCaptionsForDisplay(displayMaterial.blocks, i)
                  }
                  onVerifiedAnswer={onVerifiedAnswer}
                  materialCheckResult={materialCheckResults.find(
                    (result) =>
                      result.checkId ===
                      (block.type === "check" ? block.checkId : undefined),
                  )}
                  {...topicRegenForHeading(i)}
                />
              </>
            }
          </div>
        ))}

      {selectionToolbar && followUp && (
        <SelectionFollowUpToolbar
          getAnchorRect={getSelectionToolbarRect}
          onAsk={() => {
            const rect = getSelectionToolbarRect();
            followUp.onOpenFollowUp(selectionToolbar.anchor, {
              rect: rect ?? undefined,
              blockIndex: selectionToolbar.anchor.blockIndex,
              newThread: true,
            });
            clearSelection();
          }}
          onDismiss={clearSelection}
        />
      )}
    </div>
  );
}
