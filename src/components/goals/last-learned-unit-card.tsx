import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { LlmMarkdownInline } from "@/components/markdown/llm-markdown";
import type { LastLearnedUnit } from "@/shared/api/types";
import { statusLabel } from "@/shared/domain/unit-status";
import type { UnitStatus } from "@/shared/domain/types";
import { cn } from "@xue-learn/core/utils";
import { useI18n, useT } from "@xue-learn/core/i18n";

function formatLearnedAt(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LastLearnedUnitCard({
  goalId,
  unit,
  className,
}: {
  goalId: string;
  unit: LastLearnedUnit;
  className?: string;
}) {
  const t = useT();
  const { locale } = useI18n();

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border border-[var(--brand-200)] bg-[var(--course-content-surface-accent)] px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--brand-600)]">
          {t("goals.lastLearned")}
        </p>
        <p
          className="mt-1 text-[var(--text-800)]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          <LlmMarkdownInline content={unit.title} />
        </p>
        <p className="mt-1 text-xs text-[var(--text-400)]">
          {statusLabel(unit.status as UnitStatus, locale !== "en")} ·{" "}
          {formatLearnedAt(unit.learnedAt, locale)}
        </p>
      </div>
      <Link to={`/goals/${goalId}/units/${unit.id}`}>
        <Button size="sm" className="shrink-0 rounded-lg">
          <Play className="size-3.5" />
          {t("goals.continue")}
        </Button>
      </Link>
    </div>
  );
}
