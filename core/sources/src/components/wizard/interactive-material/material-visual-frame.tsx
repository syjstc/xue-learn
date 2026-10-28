"use client";

import { Maximize2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog.js";
import { cn } from "../../../shared/utils.js";

export function MaterialVisualFrame({
  title,
  caption,
  compact = false,
  actions,
  children,
  expanded,
  expandedContent,
  expandedToolbar,
  fullscreenLabel,
  fullscreenHint,
  onExpandedChange,
  onOpenFullscreen,
}: {
  title?: ReactNode;
  caption?: ReactNode;
  compact?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  expanded: boolean;
  expandedContent: ReactNode;
  expandedToolbar?: ReactNode;
  fullscreenLabel: string;
  fullscreenHint?: string;
  onExpandedChange: (expanded: boolean) => void;
  onOpenFullscreen: () => void;
}) {
  return (
    <>
      <figure
        className={cn(
          "relative py-1",
          !compact &&
            "sm:rounded-2xl sm:border sm:border-[var(--course-content-border)] sm:bg-[var(--course-content-surface)] sm:p-5",
        )}
      >
        <header className="mb-2 flex items-start justify-between gap-3 sm:mb-3">
          {title ? (
            <figcaption className="min-w-0 font-semibold leading-snug text-[var(--course-content)]">
              {title}
            </figcaption>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            <button
              type="button"
              onClick={onOpenFullscreen}
              aria-label={fullscreenLabel}
              title={fullscreenLabel}
              className="inline-flex size-10 items-center justify-center rounded-xl border border-[var(--course-content-border)] bg-[var(--course-content-surface)]/90 text-[var(--course-content-muted)] shadow-sm transition hover:text-[var(--course-content)]"
            >
              <Maximize2 className="size-4.5" aria-hidden />
            </button>
          </div>
        </header>
        {children}
        {caption ? (
          <div className="mt-2 px-1 text-center text-sm leading-6 text-[var(--course-content-muted)] sm:mt-3 sm:px-0">
            {caption}
          </div>
        ) : null}
      </figure>

      <Dialog open={expanded} onOpenChange={onExpandedChange}>
        <DialogContent
          data-material-visual-dialog
          className="fixed! inset-0! flex h-[100dvh]! w-screen! max-w-none! translate-x-0! translate-y-0! flex-col gap-0 overflow-hidden rounded-none! bg-[var(--course-content-surface)] p-0 ring-0 will-change-[opacity] data-open:duration-200 data-open:zoom-in-100 data-closed:duration-150 data-closed:zoom-out-100 motion-reduce:animate-none"
          showOverlay={false}
          closeButtonClassName="top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] bg-background/80 shadow-sm backdrop-blur hover:bg-background"
        >
          <DialogHeader
            data-material-visual-dialog-header
            className="shrink-0 border-b border-[var(--course-content-border)] px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] pr-16"
          >
            <DialogTitle className="truncate text-base">
              {title || fullscreenLabel}
            </DialogTitle>
            {fullscreenHint ? (
              <DialogDescription className="text-xs portrait:block landscape:hidden">
                {fullscreenHint}
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {expandedContent}
            {expandedToolbar}
          </div>
          {caption ? (
            <div className="shrink-0 border-t border-[var(--course-content-border)] bg-[var(--course-content-surface)] px-4 py-2 text-center text-xs text-[var(--course-content-muted)]">
              {caption}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MaterialVisualToolbar({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-2xl bg-background/95 p-1.5 text-foreground shadow-lg ring-1 ring-foreground/10"
      role="toolbar"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function MaterialVisualToolbarButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-xl text-foreground transition hover:bg-muted disabled:opacity-35",
        className,
      )}
      {...props}
    />
  );
}
