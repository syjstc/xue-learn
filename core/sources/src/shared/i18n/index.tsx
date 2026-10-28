"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { isDev } from "../dev.js";
import { isDesktopLocalRuntime } from "../runtime/client-runtime.js";
import {
  readLocalAppearancePreferences,
  writeLocalAppearancePreferences,
} from "../runtime/local-preferences.js";
import { en, type TranslationMessages } from "./locales/en.js";
import { zhHans } from "./locales/zh-Hans.js";
import { zhHant } from "./locales/zh-Hant.js";

export const UI_LOCALES = ["zh-Hans", "zh-Hant", "en"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];
export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string | number>;

const FORCED_LOCALE: UiLocale = "zh-Hans";
const DEV_LOCALE_STORAGE_KEY = "xuelearn.dev.ui-locale";

const dictionaries: Record<UiLocale, TranslationMessages> = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

function interpolate(message: string, params?: TranslationParams): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

function normalizeSupportedLocale(locale: string): UiLocale {
  if (
    locale === "zh-Hant" ||
    locale.startsWith("zh-TW") ||
    locale.startsWith("zh-HK")
  ) {
    return "zh-Hant";
  }
  if (locale === "zh-Hans" || locale.startsWith("zh-CN")) {
    return "zh-Hans";
  }
  return "en";
}

function getDevLocale(): UiLocale {
  if (isDesktopLocalRuntime()) return FORCED_LOCALE;
  if (
    (!isDev() && !isDesktopLocalRuntime()) ||
    typeof localStorage === "undefined"
  ) {
    return FORCED_LOCALE;
  }
  const saved = localStorage.getItem(DEV_LOCALE_STORAGE_KEY);
  return UI_LOCALES.includes(saved as UiLocale)
    ? (saved as UiLocale)
    : FORCED_LOCALE;
}

export function translateForLocale(
  locale: string,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const supportedLocale = normalizeSupportedLocale(locale);
  return interpolate(dictionaries[supportedLocale][key] ?? en[key], params);
}

type I18nContextValue = {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

// Public renderer bundles and compatibility source imports can coexist in one
// host. Share the context identity across those module copies; locale values
// still belong to each React provider and are never stored globally.
const I18N_CONTEXT_KEY = Symbol.for("org.xuelearn.i18n.context.v1");
const contextRegistry = globalThis as typeof globalThis & {
  [I18N_CONTEXT_KEY]?: Context<I18nContextValue | null>;
};
const I18nContext = contextRegistry[I18N_CONTEXT_KEY] ??= createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(getDevLocale);

  useEffect(() => {
    let active = true;
    void readLocalAppearancePreferences().then((preferences) => {
      if (active && preferences) setLocaleState(preferences.uiLocale);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = dictionaries[locale]["app.documentTitle"];
  }, [locale]);

  const setLocale = useCallback((next: UiLocale) => {
    if (!isDev() && !isDesktopLocalRuntime()) return;
    setLocaleState(next);
    if (!isDesktopLocalRuntime()) {
      localStorage.setItem(DEV_LOCALE_STORAGE_KEY, next);
    }
    writeLocalAppearancePreferences({ uiLocale: next });
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) =>
      interpolate(dictionaries[locale][key] ?? en[key], params),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}

export function useT() {
  return useI18n().t;
}

export function getCurrentUiLocale(): UiLocale {
  return getDevLocale();
}

export function getUiLocaleNativeName(locale: UiLocale): string {
  switch (locale) {
    case "en":
      return "English";
    case "zh-Hans":
      return "简体中文";
    case "zh-Hant":
      return "繁體中文";
  }
}
