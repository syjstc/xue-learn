"use client";

import { ChevronDown } from "lucide-react";
import { CourseCallout } from "@xue-learn/core/display/course-callout";
import type { InteractiveBlock } from "@xue-learn/core/schemas";
import type { TextHighlightSpan } from "@xue-learn/core/shared/domain/material-highlight";
import type { ContentSource } from "@xue-learn/core/shared/types/content-sources";
import type { MaterialFollowUpHandlers } from "@/hooks/use-material-text-selection";
import { useT } from "@xue-learn/core/i18n";
import { Selectable } from "../selectable.tsx";

export function CalloutBlock({
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
  block: Extract<InteractiveBlock, { type: "callout" }>;
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
  const calloutLabels = {
    tip: t("wizard.material.callout.tip"),
    warning: t("wizard.material.callout.warning"),
    definition: t("wizard.material.callout.definition"),
    example: t("wizard.material.callout.example"),
  } as const;
  return (
    <CourseCallout
      variant={block.variant}
      label={calloutLabels[block.variant]}
      compact={compact}
      title={
        block.title ? (
          <Selectable
            contentKey={`${blockKey}:title`}
            text={block.title}
            highlights={highlights}
            sources={sources}
            followUp={followUp}
            markdownVariant="inline"
            animateText={animateText}
            typewriterResetKey={typewriterResetKey}
            onTextAnimationComplete={onTextAnimationComplete}
          />
        ) : undefined
      }
      body={
        <Selectable
          contentKey={blockKey}
          text={block.body}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
          animateText={animateText}
          typewriterResetKey={typewriterResetKey}
          onTextAnimationComplete={onTextAnimationComplete}
        />
      }
    />
  );
}

export function AccordionBlock({
  block,
  blockKey,
  compact,
  highlights,
  sources,
  followUp,
}: {
  block: Extract<InteractiveBlock, { type: "accordion" }>;
  blockKey: string;
  compact?: boolean;
  highlights: Map<string, TextHighlightSpan[]>;
  sources?: ContentSource[];
  followUp?: MaterialFollowUpHandlers;
}) {
  const t = useT();
  return (
    <details
      className={`group rounded-lg border border-[var(--course-content-border)] bg-[var(--course-content-surface)] open:border-[var(--course-content-border-accent)] open:bg-[var(--course-content-surface-accent)] ${compact ? "" : "shadow-sm"}`}
    >
      <summary className="cursor-pointer list-none px-3 py-2 font-medium text-[var(--course-content)] marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronDown
              className="size-3.5 shrink-0 text-[var(--course-content-muted)] transition-transform group-open:rotate-180"
              aria-hidden
            />
            <Selectable
              contentKey={`${blockKey}:title`}
              text={block.title}
              highlights={highlights}
              sources={sources}
              followUp={followUp}
              markdownVariant="inline"
            />
          </span>
          <span className="text-xs font-normal text-[var(--course-content-muted)] group-open:hidden">
            {t("wizard.material.accordion.expand")}
          </span>
        </span>
      </summary>
      <div className="border-t border-[var(--course-content-border)] px-3 pb-3 pt-2 text-[var(--course-content)]">
        <Selectable
          contentKey={blockKey}
          text={block.body}
          highlights={highlights}
          sources={sources}
          followUp={followUp}
        />
      </div>
    </details>
  );
}
