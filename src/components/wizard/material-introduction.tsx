"use client";

import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function materialIntroductionShellClass(
  compact?: boolean,
  emphasize?: boolean,
): string {
  return cn(
    "relative overflow-hidden rounded-xl border border-[var(--course-content-border-accent)]",
    "bg-[var(--course-content-surface-accent)] shadow-sm",
    "before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[var(--course-content-link)]",
    compact ? "p-3 pl-4" : "p-5 pl-6 md:p-6 md:pl-7",
    emphasize &&
      "ring-2 ring-[var(--course-content-attention-border)] ring-offset-1 bg-[var(--course-content-highlight-bg)]",
  );
}

export function MaterialIntroductionBlock({
  compact = false,
  emphasize = false,
  className,
  children,
}: {
  compact?: boolean;
  emphasize?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div
      className={cn(materialIntroductionShellClass(compact, emphasize), className)}
    >
      <div className={cn("mb-3 flex items-center gap-2", compact && "mb-2")}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--course-content-highlight-bg)] text-[var(--course-content-link)]">
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--course-content-link)]">
          {t("wizard.material.introduction")}
        </span>
      </div>
      <div
        className={cn(
          "leading-relaxed text-[var(--course-content)]",
          compact ? "text-sm" : "text-base md:text-[1.05rem]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
