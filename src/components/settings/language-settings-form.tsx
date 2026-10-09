"use client";

import { Languages } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  getUiLocaleNativeName,
  UI_LOCALES,
  useI18n,
  useT,
  type TranslationKey,
  type UiLocale,
} from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { cn } from "@xue-learn/core/source/src/shared/utils.ts";

const LOCALE_LABEL_KEYS: Record<UiLocale, TranslationKey> = {
  en: "common.english",
  "zh-Hans": "common.simplifiedChinese",
  "zh-Hant": "common.traditionalChinese",
};

export function LanguageSettingsForm({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useI18n();
  const t = useT();

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {!compact && (
        <div className="space-y-1">
          <Label className="flex items-center gap-2 text-sm font-medium">
            <Languages className="h-4 w-4" aria-hidden />
            {t("i18n.uiLanguage")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("i18n.uiLanguageDescription")}
          </p>
        </div>
      )}
      {compact && (
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Languages className="h-4 w-4" aria-hidden />
          {t("i18n.uiLanguage")}
        </Label>
      )}
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("i18n.uiLanguage")}>
        {UI_LOCALES.map((option) => {
          const active = locale === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(option)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left text-sm transition",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="block font-medium">{t(LOCALE_LABEL_KEYS[option])}</span>
              <span className="mt-0.5 block text-xs opacity-75">
                {getUiLocaleNativeName(option)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
