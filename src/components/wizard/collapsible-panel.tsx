"use client";

import type { ReactNode } from "react";
import { cn } from "@xue-learn/core/utils";
import { useT } from "@xue-learn/core/i18n";

export function CollapsiblePanel({
  title,
  hint,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
  className,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  return (
    <details
      className={cn(
        "group overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/10 open:bg-muted/30",
        className,
      )}
      open={open ?? defaultOpen}
      onToggle={(event) => {
        onOpenChange?.(event.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer list-none px-3 py-2.5 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-2">
          <span>
            <span className="text-sm font-semibold">{title}</span>
            {hint && (
              <span className="ml-2 text-xs font-medium text-[var(--text-400)]">
                {hint}
              </span>
            )}
          </span>
          <span className="text-xs font-medium text-[var(--text-400)] group-open:hidden">{t("wizard.collapsible.expand")}</span>
          <span className="hidden text-xs font-medium text-[var(--text-400)] group-open:inline">
            {t("wizard.collapsible.collapse")}
          </span>
        </span>
      </summary>
      <div className="border-t px-3 pt-2 pb-3">{children}</div>
    </details>
  );
}
