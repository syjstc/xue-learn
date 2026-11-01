"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { isDesktopLocalRuntime } from "../runtime/client-runtime.js";
import {
  readLocalAppearancePreferences,
  writeLocalAppearancePreferences,
} from "../runtime/local-preferences.js";
import { en, type TranslationMessages } from "./locales/en.js";
import { zhHans } from "./locales/zh-Hans.js";
import { zhHant } from "./locales/zh-Hant.js";
import {
  UI_LOCALES,
  getSystemUiLocale,
  resolveUiLocale,
  supportedUiLocale,
  type UiLocale,
  type UiLocalePreference,
} from "./locale.js";

export {
  UI_LOCALES,
  detectUiLocale,
  getSystemUiLocale,
  resolveUiLocale,
  supportedUiLocale,
  type UiLocale,
  type UiLocalePreference,
} from "./locale.js";
export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string | number>;

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
  return supportedUiLocale(locale) ?? "en";
}

function getInitialPreference(): UiLocalePreference {
  if (isDesktopLocalRuntime() || typeof localStorage === "undefined")
    return "system";
  try {
    const saved = localStorage.getItem(DEV_LOCALE_STORAGE_KEY);
    return UI_LOCALES.includes(saved as UiLocale)
      ? (saved as UiLocale)
      : "system";
  } catch {
    return "system";
  }
}

export function applyUiLocale(locale: UiLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.title = dictionaries[locale]["app.documentTitle"];
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
  localePreference: UiLocalePreference;
  setLocale: (locale: UiLocalePreference) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

// Public renderer bundles and compatibility source imports can coexist in one
// host. Share the context identity across those module copies; locale values
// still belong to each React provider and are never stored globally.
const I18N_CONTEXT_KEY = Symbol.for("org.xuelearn.i18n.context.v1");
const contextRegistry = globalThis as typeof globalThis & {
  [I18N_CONTEXT_KEY]?: Context<I18nContextValue | null>;
};
const I18nContext = (contextRegistry[I18N_CONTEXT_KEY] ??=
  createContext<I18nContextValue | null>(null));

export function I18nProvider({
  children,
  initialLocalePreference,
}: {
  children: ReactNode;
  initialLocalePreference?: UiLocalePreference;
}) {
  const [localePreference, setLocalePreference] = useState<UiLocalePreference>(
    initialLocalePreference ?? getInitialPreference,
  );
  const [systemLocale, setSystemLocale] = useState<UiLocale>(getSystemUiLocale);
  const locale =
    localePreference === "system" ? systemLocale : localePreference;
  const changed = useRef(false);

  useEffect(() => {
    if (initialLocalePreference !== undefined) return;
    let active = true;
    void readLocalAppearancePreferences().then((preferences) => {
      if (active && !changed.current && preferences)
        setLocalePreference(preferences.uiLocale);
    });
    return () => {
      active = false;
    };
  }, [initialLocalePreference]);

  useEffect(() => {
    const update = () => setSystemLocale(getSystemUiLocale());
    window.addEventListener("languagechange", update);
    return () => window.removeEventListener("languagechange", update);
  }, []);

  useLayoutEffect(() => {
    applyUiLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: UiLocalePreference) => {
    changed.current = true;
    // Set the request language before the newly translated UI starts any API work.
    applyUiLocale(resolveUiLocale(next));
    setLocalePreference(next);
    if (!isDesktopLocalRuntime()) {
      try {
        localStorage.setItem(DEV_LOCALE_STORAGE_KEY, next);
      } catch {
        /* Private browsing may disable storage. */
      }
    }
    writeLocalAppearancePreferences({ uiLocale: next });
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) =>
      interpolate(dictionaries[locale][key] ?? en[key], params),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, localePreference, setLocale, t }),
    [locale, localePreference, setLocale, t],
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
  // Shared display components also render in standalone preview and video hosts.
  return useContext(I18nContext)?.t ?? translateCurrent;
}

export function getCurrentUiLocale(): UiLocale {
  return (
    (typeof document !== "undefined" &&
      supportedUiLocale(document.documentElement.lang)) ||
    resolveUiLocale(getInitialPreference())
  );
}

/** For request/error helpers outside React; uses the active interface language. */
export function translateCurrent(
  key: TranslationKey,
  params?: TranslationParams,
): string {
  return translateForLocale(getCurrentUiLocale(), key, params);
}

export function countVariant(
  count: number,
  locale: UiLocale = getCurrentUiLocale(),
): "one" | "other" {
  return new Intl.PluralRules(locale).select(count) === "one" ? "one" : "other";
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
