import type { UnitContentGenStatus } from "@/shared/domain/unit-content-status";
import { cn } from "@xue-learn/core/utils";

function GenChip({
  label,
  done,
  compact,
  tone = "success",
}: {
  label: string;
  done: boolean;
  compact?: boolean;
  tone?: "success" | "brand";
}) {
  return (
    <span
      className={cn(
        "rounded font-medium",
        compact ? "px-1 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]",
        done
          ? tone === "brand"
            ? "bg-[var(--brand-100)] text-[var(--brand-700)]"
            : "bg-[var(--success-100)] text-[var(--success-700)]"
          : "bg-[var(--bg-200)] text-[var(--text-400)]"
      )}
      title={done ? `${label}已生成` : `${label}未生成`}
    >
      {label}
      {done ? " ✓" : ""}
    </span>
  );
}

export function UnitContentGenBadges({
  status,
  compact,
  className,
}: {
  status: UnitContentGenStatus;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1",
        className
      )}
    >
      <GenChip label="预习" done={status.hasSurvey} compact={compact} />
      <GenChip label="正文" done={status.hasMaterial} compact={compact} />
    </span>
  );
}
