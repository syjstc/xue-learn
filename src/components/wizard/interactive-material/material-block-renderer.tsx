import { GuidedImageDisplay } from "@xue-learn/core/source/src/components/course-display/guided-image-display.tsx";
import {
  CourseChatBoard,
  supportsCourseChatBoard,
  type CourseBoardPlayback,
} from "@/components/course-display/course-chat-board";
("use client");

import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import type { TextHighlightSpan } from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import type { MaterialFollowUpHandlers } from "@/hooks/use-material-text-selection";
import type { MaterialFigureCaption } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { NewCourseInteractionBlock } from "../course-interaction-blocks.tsx";
import { CodeBlockShell } from "@xue-learn/core/source/src/components/markdown/code-block-shell.tsx";
import { Selectable } from "./selectable.tsx";
import type {
  IllustrationRegenHandlers,
  MaterialCheckResult,
  VerifiedMaterialAnswerHandler,
} from "./types.ts";
import { AccordionBlock, CalloutBlock } from "./blocks/callout-accordion.tsx";
import { CheckBlock } from "./blocks/check.tsx";
import { LegacyCompareBlock } from "./blocks/legacy-compare.tsx";
import { ComposedStageBlock } from "./blocks/composed-stage.tsx";
import { ConversationBlock } from "./blocks/conversation.tsx";
import { IllustrationBlock } from "./blocks/illustration.tsx";
import { MaterialPlaceholderBlock } from "./blocks/placeholder.tsx";
import { SvgDiagramBlock } from "./blocks/svg-diagram.tsx";
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

  if ((guided || block.type === "visual" || block.type === "music" || block.type === "teaching") && supportsCourseChatBoard(block)) {
    return (
      <CourseChatBoard
        block={block}
        activeTargetIds={activeTargetIds}
        playback={boardPlayback}
        renderCode={(figure) => (
          <CodeBlockShell
            presentation="chat"
            className="course-chat-code-board"
            code={String(figure.code ?? "")}
            language={String(figure.language ?? "")}
            contentKey={blockKey}
            spans={highlights.get(blockKey) ?? []}
            onSpanClick={followUp?.onHighlightClick}
            parts={
              figure.parts as Extract<
                InteractiveBlock,
                { type: "code" }
              >["parts"]
            }
            activeTargetIds={activeTargetIds}
            figureId={typeof figure.id === "string" ? figure.id : undefined}
          />
        )}
        renderMedia={(figure) => (
          <MaterialBlockView
            block={figure as unknown as InteractiveBlock}
            blockIndex={blockIndex}
            compact={compact}
            highlights={highlights}
            sources={sources}
            followUp={followUp}
            illustrationRegen={
              illustrationRegen && block.type === "stage"
                ? {
                    ...illustrationRegen,
                    parentBlockIndex: blockIndex,
                    figureIndex: block.figures.findIndex(
                      (item) => item === figure,
                    ),
                  }
                : illustrationRegen
            }
          />
        )}
      />
    );
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
        return <CodeBlockShell code={block.text} contentKey={blockKey} />;
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
    case "code":
      return (
        <CodeBlockShell
          code={block.code}
          language={block.language}
          contentKey={blockKey}
          spans={highlights.get(blockKey) ?? []}
          onSpanClick={followUp?.onHighlightClick}
          parts={block.parts}
          activeTargetIds={activeTargetIds}
          figureId={block.id}
        />
      );
    case "conversation":
      return (
        <ConversationBlock
          block={block}
          blockKey={blockKey}
          compact={compact}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
          {...textProps}
        />
      );
    case "callout":
      return (
        <CalloutBlock
          block={block}
          blockKey={blockKey}
          compact={compact}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
          {...textProps}
        />
      );
    case "accordion":
      return (
        <AccordionBlock
          block={block}
          blockKey={blockKey}
          compact={compact}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
        />
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
    case "compare":
      return (
        <LegacyCompareBlock
          block={block}
          blockKey={blockKey}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
          compact={compact}
          activeTargetIds={activeTargetIds}
          figureCaptions={figureCaptions}
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
    case "illustration":
      if (block.guidedImage) return <GuidedImageDisplay display={block.guidedImage} activeTargetIds={activeTargetIds} />;
      return (
        <IllustrationBlock
          block={block}
          blockIndex={blockIndex}
          blockKey={blockKey}
          compact={compact}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
          illustrationRegen={illustrationRegen}
        />
      );
    case "svg":
      return (
        <ComplexComponentRetry
          blockIndex={blockIndex}
          regeneration={illustrationRegen}
        >
          <SvgDiagramBlock
            block={block}
            blockIndex={blockIndex}
            compact={compact}
            illustrationRegen={illustrationRegen}
          />
        </ComplexComponentRetry>
      );
    case "stage":
      return (
        <ComposedStageBlock
          block={block}
          activeTargetIds={activeTargetIds}
          guided={guided}
          figureCaptions={figureCaptions}
          renderFigure={(figure, index, captions) => (
            <MaterialBlockView
              block={figure}
              blockIndex={blockIndex * 1000 + index}
              compact={compact}
              revealAnswers={revealAnswers}
              deferredSubmit={deferredSubmit}
              followUp={followUp}
              highlights={highlights}
              sources={sources}
              illustrationRegen={
                illustrationRegen
                  ? {
                      ...illustrationRegen,
                      parentBlockIndex: blockIndex,
                      figureIndex: index,
                    }
                  : undefined
              }
              activeTargetIds={guided ? activeTargetIds : []}
              figureCaptions={captions}
            />
          )}
        />
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
