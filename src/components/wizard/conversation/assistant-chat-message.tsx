"use client";

import type { ReactNode } from "react";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

export const ASSISTANT_TYPEWRITER_CHARS_PER_TICK = 3;
export const ASSISTANT_TYPEWRITER_MS_PER_TICK = 66;

export function AssistantChatMessage({
  avatarSrc,
  name,
  showAvatar = true,
  showName = false,
  current = true,
  children,
  className,
  bubbleClassName,
}: {
  avatarSrc: string;
  name: string;
  showAvatar?: boolean;
  showName?: boolean;
  current?: boolean;
  children: ReactNode;
  className?: string;
  bubbleClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2.5 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-x-3 md:grid-cols-[2.5rem_minmax(0,1fr)]",
        className,
      )}
    >
      {showAvatar ? (
        <img
          src={avatarSrc}
          alt=""
          className="size-8 rounded-full object-cover ring-1 ring-[var(--course-content-border)] sm:size-9 md:size-10"
        />
      ) : (
        <span aria-hidden />
      )}
      <div className="min-w-0">
        {showName ? (
          <p className="mb-1 text-xs font-semibold text-[var(--course-content-muted)]">
            {name}
          </p>
        ) : null}
        <div
          className={cn(
            "relative min-w-0 max-w-[42rem] rounded-[1.125rem] rounded-tl-sm px-4 py-3 transition-colors motion-reduce:transition-none sm:px-5 sm:py-3.5",
            current
              ? "bg-[var(--course-content-surface-muted)]/65"
              : "bg-[var(--course-content-surface-muted)]/25",
            bubbleClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
