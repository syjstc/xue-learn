"use client";

import {
  type ReactNode,
  useState,
} from "react";
import {
  Maximize2,
  RotateCcw,
  Sparkles,
  Sliders,
  Activity,
} from "lucide-react";
import { cn } from "@xue-learn/core/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/ui/dialog";

export type LabShellProps = {
  title: string;
  summary?: string;
  targetObservation?: string;
  children: ReactNode;
  controls?: ReactNode;
  readouts?: ReactNode;
  onReset?: () => void;
  compact?: boolean;
  className?: string;
  canvasClassName?: string;
  badge?: string;
  headerActions?: ReactNode;
};

export function LabShell({
  title,
  summary,
  targetObservation,
  children,
  controls,
  readouts,
  onReset,
  compact = false,
  className,
  canvasClassName,
  badge = "虚拟实验",
  headerActions,
}: LabShellProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const headerContent = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--course-content-border-accent)] pb-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-primary)]">
          <Sparkles className="h-3 w-3" />
          {badge}
        </span>
        <h4 className="text-base font-semibold text-[var(--course-content)]">
          {title}
        </h4>
      </div>
      <div className="flex items-center gap-1.5">
        {headerActions}
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            title="重置实验参数"
            aria-label="重置实验参数"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface)] text-[var(--course-content-muted)] transition hover:bg-[var(--course-content-surface-hover)] hover:text-[var(--course-content)]"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          title="全屏展开"
          aria-label="全屏展开"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface)] text-[var(--course-content-muted)] transition hover:bg-[var(--course-content-surface-hover)] hover:text-[var(--course-content)]"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const mainView = (
    <div className="flex flex-col gap-4">
      {summary && (
        <p className="text-xs text-[var(--course-content-muted)] leading-relaxed">
          {summary}
        </p>
      )}

      {/* Main Canvas / Simulation viewport */}
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border border-[var(--course-content-border)] bg-[var(--course-content-surface)]",
          canvasClassName,
        )}
      >
        {children}
      </div>

      {/* Observation Insight */}
      {targetObservation && (
        <div className="flex items-start gap-2 rounded-md bg-[var(--color-primary-subtle)] p-3 text-xs text-[var(--course-content)]">
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--color-primary)] mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-semibold text-[var(--color-primary)]">
              观察要点：
            </span>
            {targetObservation}
          </div>
        </div>
      )}

      {/* Controls & Metrics Panel */}
      {(controls || readouts) && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {controls && (
            <div className="rounded-lg border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface)] p-3.5">
              <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--course-content)]">
                <Sliders className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                <span>交互控制与参数调节</span>
              </div>
              <div className="flex flex-col gap-3">{controls}</div>
            </div>
          )}

          {readouts && (
            <div className="rounded-lg border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface)] p-3.5">
              <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--course-content)]">
                <Activity className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                <span>实时物理与数据读数</span>
              </div>
              <div className="flex flex-col gap-2">{readouts}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <section
        className={cn(
          "rounded-xl border border-[var(--course-content-border-accent)] bg-[var(--course-content-surface-muted)] transition-all",
          compact ? "p-3.5" : "p-4 md:p-5",
          className,
        )}
      >
        {headerContent}
        <div className="mt-4">{mainView}</div>
      </section>

      {/* Fullscreen Dialog */}
      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-6 bg-[var(--course-content-surface-muted)] text-[var(--course-content)] border-[var(--course-content-border-accent)]">
          <DialogHeader className="border-b border-[var(--course-content-border-accent)] pb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-primary)]">
                <Sparkles className="h-3 w-3" />
                {badge}
              </span>
              <DialogTitle className="text-lg font-bold text-[var(--course-content)]">
                {title}
              </DialogTitle>
            </div>
            {summary && (
              <DialogDescription className="text-xs text-[var(--course-content-muted)]">
                {summary}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="mt-4">{mainView}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
