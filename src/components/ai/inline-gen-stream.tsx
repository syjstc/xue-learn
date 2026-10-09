"use client";

import type { ReactNode } from "react";
import { AiGenStopButton } from "./ai-gen-stop-button.tsx";
import { LlmLoadingStatus } from "./llm-loading-status.tsx";
import { cn } from "@xue-learn/core/utils";
import type { KnowledgeActivity } from "@xue-learn/core/domain";
import { KnowledgeActivityCard } from "@/components/agent/knowledge-activity-card";

export function InlineGenStream({
  status,
  progress,
  canStop,
  onStop,
  className,
  children,
  knowledgeActivity,
}: {
  status?: string;
  progress?: { current: number; total: number } | null;
  canStop?: boolean;
  onStop?: () => void;
  className?: string;
  children?: ReactNode;
  knowledgeActivity?: KnowledgeActivity;
}) {
  if (!status && !progress && !children && !knowledgeActivity)
    return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--brand-200)] bg-[var(--brand-50)] px-3 py-2.5",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {status && (
          <LlmLoadingStatus
            className="text-sm text-[var(--brand-700)]"
            iconClassName="text-[var(--brand-500)]"
            live={false}
          >
            {status}
          </LlmLoadingStatus>
        )}
        {canStop && onStop && <AiGenStopButton onStop={onStop} />}
      </div>

      {progress && progress.total > 0 && (
        <div className="mt-2 space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--brand-100)]">
            <div
              className="h-full rounded-full bg-[var(--brand-500)] transition-all duration-300"
              style={{
                width: `${Math.round((progress.current / progress.total) * 100)}%`,
              }}
            />
          </div>
          <p className="text-[11px] text-[var(--brand-600)]">
            {progress.current} / {progress.total}
          </p>
        </div>
      )}

      {children}
      {knowledgeActivity ? (
        <div className="mt-2">
          <KnowledgeActivityCard activity={knowledgeActivity} />
        </div>
      ) : null}

    </div>
  );
}
