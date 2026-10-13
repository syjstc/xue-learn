import {DisplayBlockHost} from "@/features/display/display-block-host";
import type {CourseBoardPlayback} from "@/components/course-display/course-chat-board";
("use client");

import type { InteractiveBlock } from "@xue-learn/core/schemas";
import type { TextHighlightSpan } from "@xue-learn/core/shared/domain/material-highlight";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import type { MaterialFollowUpHandlers } from "@/hooks/use-material-text-selection";
import type { MaterialFigureCaption } from "@xue-learn/core/domain";
import { NewCourseInteractionBlock } from "../course-interaction-blocks.tsx";
import { Selectable } from "./selectable.tsx";
import type {
  IllustrationRegenHandlers,
  MaterialCheckResult,
  VerifiedMaterialAnswerHandler,
} from "./types.ts";
import { CheckBlock } from "./blocks/check.tsx";
import { MaterialPlaceholderBlock } from "./blocks/placeholder.tsx";
import { InteractiveHtmlBlock } from "./blocks/interactive-html-block.tsx";
import { ComplexComponentRetry } from "./blocks/complex-component-retry.tsx";
import { AiBlockEditShell } from "./blocks/ai-block-edit.tsx";
import { TopicRegenButton } from "@/components/wizard/unit-sections/topic-regen-button";
import { isTopicHeading } from "@/shared/domain/material-topic-identity";

/** Legacy material stored short code snippets as paragraphs before `code` existed. */
function looksLikeStandaloneCode(text: string): boolean {
  const value = text.trim();
  if (!value || value.includes("\n")) return false;
  return /^(?:[A-Za-z_$][\w$]*(?:\.[\w$]+)*\s*=\s*[^=].*|(?:const|let|var|def|class|import|from|print|console\.log)\b.*|[\w.-]+\s+--?[\w-]+)/.test(
    value,
  );
}

function MaterialBlockView({
  block,
  blockIndex,
  compact,
  revealAnswers = false,
  publicQuizMode = false,
  followUp,
  highlights,
  sources,
  animateText = false,
  typewriterResetKey,
  typewriterCharsPerTick,
  typewriterMsPerTick,
  onTextAnimationComplete,
  onCheckAnswered,
  illustrationRegen,
  onVerifiedAnswer,
  materialCheckResult,
  deferredSubmit = false,
  activeTargetIds = [],
  guided = false,
  boardPlayback,
  figureCaptions = [],
  onRegenerateTopic,
  regeneratingTopic = false,
}: {
  block: InteractiveBlock;
  blockIndex: number;
  compact?: boolean;
  revealAnswers?: boolean;
  /** Public share: answer without revealing correct options or explanations. */
  publicQuizMode?: boolean;
  deferredSubmit?: boolean;
  followUp?: MaterialFollowUpHandlers;
  highlights: Map<string, TextHighlightSpan[]>;
  sources?: ContentSource[];
  animateText?: boolean;
  typewriterResetKey?: string | number;
  typewriterCharsPerTick?: number;
  typewriterMsPerTick?: number;
  onTextAnimationComplete?: () => void;
  onCheckAnswered?: (answered: boolean) => void;
  illustrationRegen?: IllustrationRegenHandlers;
  onVerifiedAnswer?: VerifiedMaterialAnswerHandler;
  materialCheckResult?: MaterialCheckResult;
  activeTargetIds?: readonly string[];
  guided?: boolean;
  boardPlayback?: CourseBoardPlayback;
  figureCaptions?: readonly MaterialFigureCaption[];
  onRegenerateTopic?: () => void;
  regeneratingTopic?: boolean;
}) {
  const blockKey = `block:${blockIndex}`;
  const textProps = {
    animateText,
    typewriterResetKey,
    typewriterCharsPerTick,
    typewriterMsPerTick,
    onTextAnimationComplete,
  };

  if (["display", "visual", "music", "teaching", "stage", "code", "compare", "callout", "accordion", "illustration", "svg", "conversation"].includes(block.type)) {
    return <DisplayBlockHost block={block} id={"id" in block && typeof block.id === "string" ? block.id : blockKey} activeTargetIds={activeTargetIds} playback={boardPlayback}/>;
  }

  switch (block.type) {
    case "heading": {
      const headingText = (
        <Selectable
          contentKey={blockKey}
          text={block.text}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
          {...textProps}
        />
      );
      if (block.level === 2 || (onRegenerateTopic && isTopicHeading(block))) {
        return (
          <div
            className={
              compact
                ? "flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-[var(--course-content-border)] pb-1"
                : "flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-[var(--course-content-border)] pb-2"
            }
          >
            {block.level === 2 ? (
              <h4
                className={
                  compact
                    ? "min-w-0 flex-1 basis-40 font-semibold text-[var(--course-content)]"
                    : "min-w-0 flex-1 basis-40 text-lg font-semibold text-[var(--course-content)]"
                }
              >
                {headingText}
              </h4>
            ) : (
              <h5 className="min-w-0 flex-1 basis-40 font-medium text-[var(--course-content)]">
                {headingText}
              </h5>
            )}
            {onRegenerateTopic ? (
              <TopicRegenButton
                busy={regeneratingTopic}
                onClick={onRegenerateTopic}
              />
            ) : null}
          </div>
        );
      }
      return (
        <h5 className="font-medium text-[var(--course-content)]">
          {headingText}
        </h5>
      );
    }
    case "paragraph":
      if (looksLikeStandaloneCode(block.text)) {
        return <DisplayBlockHost block={{type: "code", code: block.text, language: "text"}} id={blockKey}/>;
      }
      return (
        <div className="text-[var(--course-content)]">
          <Selectable
            contentKey={blockKey}
            text={block.text}
            highlights={highlights}
            sources={sources}
            followUp={followUp}
            {...textProps}
          />
        </div>
      );
    case "check":
      return (
        <CheckBlock
          block={block}
          blockIndex={blockIndex}
          blockKey={blockKey}
          compact={compact}
          revealAnswer={revealAnswers}
          publicQuizMode={publicQuizMode}
          deferredSubmit={deferredSubmit}
          followUp={followUp}
          highlights={highlights}
          sources={sources}
          animateText={animateText}
          typewriterResetKey={typewriterResetKey}
          onTextAnimationComplete={onTextAnimationComplete}
          onAnsweredChange={onCheckAnswered}
          onVerifiedAnswer={onVerifiedAnswer}
          materialCheckResult={materialCheckResult}
        />
      );
    case "step_sort":
    case "graph":
    case "chart":
    case "math_scene":
    case "mechanics_sandbox":
    case "circuit_sandbox":
    case "chemistry_lab":
      return (
        <ComplexComponentRetry
          blockIndex={blockIndex}
          regeneration={illustrationRegen}
        >
          <NewCourseInteractionBlock block={block} compact={compact} />
        </ComplexComponentRetry>
      );
    case "interactive_html":
      return (
        <ComplexComponentRetry
          blockIndex={blockIndex}
          regeneration={illustrationRegen}
        >
          <InteractiveHtmlBlock block={block} compact={compact} />
        </ComplexComponentRetry>
      );
    case "placeholder":
      return (
        <MaterialPlaceholderBlock
          block={block}
          blockIndex={blockIndex}
          compact={compact}
          regeneration={illustrationRegen}
        />
      );
    default:
      return null;
  }
}

export function MaterialBlockRenderer(
  props: Parameters<typeof MaterialBlockView>[0],
) {
  const { illustrationRegen, block, blockIndex } = props;
  return (
    <AiBlockEditShell
      block={block}
      blockIndex={blockIndex}
      unitId={illustrationRegen?.unitId}
      blockOffset={illustrationRegen?.blockOffset}
      onBlockReplaced={illustrationRegen?.onBlockRegenerated}
      onBlockDeleted={illustrationRegen?.onBlockDeleted}
    >
      <MaterialBlockView {...props} />
    </AiBlockEditShell>
  );
}
