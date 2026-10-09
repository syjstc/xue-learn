import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export { designTokens } from "@xue-learn/core/source/src/shared/design-tokens.ts";

export const THEME_STORAGE_KEY = "xue-learn-theme";
export const DEFAULT_THEME: Theme = "system";

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

export function readTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  if (isDesktopLocalRuntime()) return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

export function writeTheme(theme: Theme) {
  if (isDesktopLocalRuntime()) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (resolveTheme(theme) === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}
