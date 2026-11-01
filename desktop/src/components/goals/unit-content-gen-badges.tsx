import { useT } from "@xue-learn/core/i18n";
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
  const t = useT();
  return (
    <span
      className={cn(
        "rounded font-medium",
        compact ? "px-1 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]",
        done
          ? tone === "brand"
            ? "bg-[var(--brand-100)] text-[var(--brand-700)]"
            : "bg-[var(--success-100)] text-[var(--success-700)]"
          : "bg-[var(--bg-200)] text-[var(--text-400)]",
      )}
      title={t(done ? "desktop.i18n.generated" : "desktop.i18n.notGenerated", {
        label,
      })}
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
  const t = useT();
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      <GenChip
        label={t("learningJourney.preview")}
        done={status.hasSurvey}
        compact={compact}
      />
      <GenChip
        label={t("desktop.ui.unitContentGenBadges.lessonContent")}
        done={status.hasMaterial}
        compact={compact}
      />
    </span>
  );
}
