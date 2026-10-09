"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import { Label } from "@/components/ui/label";
import { cn } from "@xue-learn/core/source/src/lib/utils.ts";
import { useT, type TranslationKey } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
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
                "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium whitespace-nowrap transition",
                compact
                  ? "justify-start sm:justify-center"
                  : "justify-start sm:justify-center",
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
