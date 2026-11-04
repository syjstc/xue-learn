"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import { Label } from "@/components/ui/label";
import { cn } from "@xue-learn/core/utils";
import { useT, type TranslationKey } from "@xue-learn/core/i18n";
import type { Theme } from "@/shared/theme";

const OPTIONS: { value: Theme; labelKey: TranslationKey; icon: typeof Sun }[] = [
  { value: "light", labelKey: "theme.light", icon: Sun },
  { value: "dark", labelKey: "theme.dark", icon: Moon },
  { value: "system", labelKey: "theme.system", icon: Monitor },
];

export function ThemeSettingsForm({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme, hydrated } = useTheme();
  const t = useT();

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {!compact && (
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t("theme.appearanceTheme")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("theme.appearanceDescription")}
          </p>
        </div>
      )}
      {compact && (
        <Label className="text-sm font-medium">{t("theme.appearanceTheme")}</Label>
      )}
      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-3",
        )}
        role="radiogroup"
        aria-label={t("theme.appearanceTheme")}
      >
        {OPTIONS.map(({ value, labelKey, icon: Icon }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!hydrated}
              onClick={() => setTheme(value)}
              className={cn(
                "flex min-w-0 items-center rounded-lg border py-2.5 text-sm font-medium whitespace-nowrap transition",
                compact
                  ? "justify-start gap-1.5 px-2 sm:justify-center"
                  : "justify-start gap-2 px-3 sm:justify-center",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
