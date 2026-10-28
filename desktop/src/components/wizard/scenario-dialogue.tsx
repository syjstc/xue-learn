"use client";

import { useEffect, useRef } from "react";
import { TypingCaret } from "@/components/ui/typing-caret";
import { ProseMarkdown } from "@xue-learn/core/components/markdown/prose-markdown";
import { useTypewriter } from "@/hooks/use-typewriter";
import { useT } from "@xue-learn/core/i18n";
import { cn } from "@xue-learn/core/utils";
import type { CSSProperties } from "react";

/**
 * Typewriter-style dialogue line for the legacy V1 stage.
 * Space skips to full text; Enter is reserved to avoid clashing with the
 * theater open/close action when the component first mounts.
 */
export function ScenarioDialogue({
  text,
  onComplete,
  className,
}: {
  text: string;
  onComplete: () => void;
  className?: string;
}) {
  const t = useT();
  const completed = useRef(false);
  const typewriter = useTypewriter(text, {
    enabled: true,
    charsPerTick: 1,
    msPerTick: 30,
    resetKey: text,
  });

  useEffect(() => {
    if (!typewriter.done || completed.current) return;
    completed.current = true;
    onComplete();
  }, [onComplete, typewriter.done]);

  useEffect(() => {
    if (typewriter.done) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " ") return;
      event.preventDefault();
      typewriter.skip();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [typewriter.done, typewriter.skip]);

  return (
    <div
      role={!typewriter.done ? "button" : undefined}
      tabIndex={!typewriter.done ? 0 : undefined}
      aria-label={
        !typewriter.done ? t("scenario.dialogue.revealAll") : undefined
      }
      className={cn(
        "relative whitespace-pre-wrap text-[15px] leading-7 text-current outline-none sm:text-base",
        !typewriter.done &&
          "cursor-pointer focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
      onClick={() => typewriter.skip()}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") typewriter.skip();
      }}
    >
      <span className="sr-only">{text}</span>
      <div aria-hidden>
        {typewriter.done ? (
          <ScenarioTheaterMarkdown content={text} />
        ) : (
          <>
            {typewriter.displayed}
            <TypingCaret />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Markdown renderer that maps semantic design tokens to theater palette.
 * Keeps all text legible against the theatrical background scrim.
 */
export function ScenarioTheaterMarkdown({
  content,
  className,
  variant = "compact",
}: {
  content: string;
  className?: string;
  variant?: "compact" | "inline";
}) {
  const stageMarkdownColors = {
    "--course-content": "currentColor",
    "--course-content-muted": "var(--theater-muted)",
    "--course-content-surface-muted": "var(--theater-panel-background)",
    "--course-content-surface-accent": "var(--theater-accent-soft)",
    "--course-content-border": "var(--theater-panel-border)",
    "--course-content-border-accent": "var(--theater-accent)",
  } as CSSProperties;

  return (
    <div style={stageMarkdownColors} className={className}>
      <ProseMarkdown
        content={content}
        variant={variant}
        className="[font-size:inherit] [line-height:inherit] [&_p]:[font-size:inherit] [&_p]:[line-height:inherit]"
      />
    </div>
  );
}
