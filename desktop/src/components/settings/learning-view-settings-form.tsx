"use client";

import { BookOpenText, MessagesSquare } from "lucide-react";
import {
  useLearningViewSettings,
  useSaveLearningViewSettings,
  type LearningViewMode,
} from "@/hooks/api/use-settings";
import { ApiErrorNotice } from "@/components/ui/api-error-notice";
import { cn } from "@xue-learn/core/utils";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";

const OPTIONS: Array<{
  value: LearningViewMode;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: typeof MessagesSquare;
}> = [
  {
    value: "chat",
    labelKey: "settings.learningView.chat",
    descriptionKey: "settings.learningView.chatDescription",
    icon: MessagesSquare,
  },
  {
    value: "reading",
    labelKey: "settings.learningView.reading",
    descriptionKey: "settings.learningView.readingDescription",
    icon: BookOpenText,
  },
];

export function LearningViewSettingsForm() {
  const t = useT();
  const settings = useLearningViewSettings();
  const save = useSaveLearningViewSettings();
  const current = settings.data?.mode ?? "chat";

  if (settings.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.experience.loading")}
      </p>
    );
  }
  if (settings.error) {
    return (
      <ApiErrorNotice
        error={settings.error}
        fallback={t("settings.experience.unavailable")}
        onRetry={() => void settings.refetch()}
      />
    );
  }

  return (
    <div
      className="grid gap-2 sm:grid-cols-2"
      role="radiogroup"
      aria-label={t("settings.learningView.title")}
    >
      {OPTIONS.map(({ value, labelKey, descriptionKey, icon: Icon }) => {
        const active = current === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={save.isPending}
            onClick={() => {
              if (!active) save.mutate(value);
            }}
            className={cn(
              "flex min-h-24 items-start gap-3 rounded-xl border p-4 text-left transition-colors",
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 size-5 shrink-0",
                active && "text-primary",
              )}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t(labelKey)}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {t(descriptionKey)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
