import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

/**
 * Blinking caret for plain-text typewriter / empty streaming states.
 * Prefer {@link typingCaretHostClassName} when the host is markdown so the
 * caret stays at the end of the last block instead of wrapping to a new line.
 */
export function TypingCaret({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-primary align-text-bottom",
        className,
      )}
      aria-hidden
    />
  );
}

/**
 * Put on a markdown root (ProseMarkdown / CitationMarkdownContent). Renders an
 * inline ::after caret on the last text block so streaming/typewriter text does
 * not push the caret onto its own line after the prose wrapper.
 *
 * Skips `div` last-children (nested ProseMarkdown under citation segments) and
 * instead targets that nested root's last block.
 */
export const typingCaretHostClassName = [
  "[&>:last-child:not(div)]:after:ml-0.5",
  "[&>:last-child:not(div)]:after:inline-block",
  "[&>:last-child:not(div)]:after:h-[1em]",
  "[&>:last-child:not(div)]:after:w-0.5",
  "[&>:last-child:not(div)]:after:animate-pulse",
  "[&>:last-child:not(div)]:after:bg-primary",
  "[&>:last-child:not(div)]:after:align-text-bottom",
  "[&>:last-child:not(div)]:after:content-['']",
  "[&>div:last-child>:last-child]:after:ml-0.5",
  "[&>div:last-child>:last-child]:after:inline-block",
  "[&>div:last-child>:last-child]:after:h-[1em]",
  "[&>div:last-child>:last-child]:after:w-0.5",
  "[&>div:last-child>:last-child]:after:animate-pulse",
  "[&>div:last-child>:last-child]:after:bg-primary",
  "[&>div:last-child>:last-child]:after:align-text-bottom",
  "[&>div:last-child>:last-child]:after:content-['']",
].join(" ");
