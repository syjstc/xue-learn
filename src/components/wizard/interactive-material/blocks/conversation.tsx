"use client";

import { MessageCircle } from "lucide-react";
import type { TextHighlightSpan } from "@xue-learn/core/source/src/shared/domain/material-highlight.ts";
import type { ContentSource } from "@xue-learn/core/source/src/shared/types/content-sources.ts";
import type { MaterialFollowUpHandlers } from "@/hooks/use-material-text-selection";
import type { InteractiveBlock } from "@xue-learn/core/source/src/shared/llm/schemas.ts";
import { Selectable } from "../selectable.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function ConversationBlock({
  block,
  blockKey,
  compact,
  highlights,
  sources,
  followUp,
  animateText,
  typewriterResetKey,
  onTextAnimationComplete,
}: {
  block: Extract<InteractiveBlock, { type: "conversation" }>;
  blockKey: string;
  compact?: boolean;
  highlights: Map<string, TextHighlightSpan[]>;
  sources?: ContentSource[];
  followUp?: MaterialFollowUpHandlers;
  animateText?: boolean;
  typewriterResetKey?: string | number;
  onTextAnimationComplete?: () => void;
}) {
  const t = useT();
  const speakers = [...new Set(block.turns.map((turn) => turn.speaker))];

  return (
    <section
      className={`rounded-2xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)] ${compact ? "p-3" : "p-4 sm:p-5"}`}
      aria-label={block.title ?? t("wizard.material.conversation")}
    >
      {block.title ? (
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--course-content)]">
          <MessageCircle className="size-4 text-[var(--primary)]" aria-hidden />
          <Selectable
            contentKey={`${blockKey}:title`}
            text={block.title}
            highlights={highlights}
            sources={sources}
            followUp={followUp}
            markdownVariant="inline"
          />
        </div>
      ) : null}
      <div className={compact ? "space-y-3" : "space-y-4"}>
        {block.turns.map((turn, turnIndex) => {
          const speakerIndex = Math.max(0, speakers.indexOf(turn.speaker));
          const alternate = speakerIndex % 2 === 1;
          return (
            <div
              className={`flex items-start gap-2.5 ${alternate ? "flex-row-reverse" : ""}`}
              key={`${turn.speaker}-${turnIndex}`}
            >
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  alternate
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--course-content-surface-muted)] text-[var(--course-content)]"
                }`}
                aria-hidden
              >
                {turn.speaker.trim().slice(0, 1).toUpperCase()}
              </div>
              <div
                className={`min-w-0 max-w-[88%] ${alternate ? "text-right" : ""}`}
              >
                <div className="mb-1 px-1 text-xs font-semibold text-[var(--course-content-muted)]">
                  {turn.speaker}
                </div>
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-left text-[var(--course-content)] ${
                    alternate
                      ? "rounded-tr-sm bg-[var(--course-content-surface-accent)]"
                      : "rounded-tl-sm bg-[var(--course-content-surface-muted)]"
                  }`}
                >
                  <Selectable
                    contentKey={`${blockKey}:turn:${turnIndex}`}
                    text={turn.text}
                    highlights={highlights}
                    sources={sources}
                    followUp={followUp}
                    animateText={animateText}
                    typewriterResetKey={
                      typewriterResetKey == null
                        ? undefined
                        : `${typewriterResetKey}:${turnIndex}`
                    }
                    onTextAnimationComplete={
                      turnIndex === block.turns.length - 1
                        ? onTextAnimationComplete
                        : undefined
                    }
                    markdownVariant="compact"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
