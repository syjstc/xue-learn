"use client";

import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

export function LlmLoadingStatus({
  children,
  className,
  iconClassName,
  live = true,
}: {
  children: ReactNode;
  className?: string;
  iconClassName?: string;
  live?: boolean;
}) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2", className)}
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
    >
      <LoaderCircle
        aria-hidden="true"
        className={cn("size-4 shrink-0 animate-spin", iconClassName)}
      />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
