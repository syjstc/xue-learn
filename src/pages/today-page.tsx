import { CalendarDays } from "lucide-react";
import { LearningAgendaPanel } from "@/components/agenda/learning-agenda-panel";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

export function TodayPage() {
  const t = useT();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-50)] text-[var(--brand-600)]">
          <CalendarDays className="size-5" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t("today.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("today.description")}
          </p>
        </div>
      </header>
      <LearningAgendaPanel />
    </div>
  );
}
