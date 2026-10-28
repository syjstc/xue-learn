import { isDesktopLocalRuntime } from "./client-runtime.js";

export type LocalTheme = "light" | "dark" | "system";
export type LocalUiLocale = "zh-Hans" | "zh-Hant" | "en";

export type LocalAppearancePreferences = {
  theme: LocalTheme;
  uiLocale: LocalUiLocale;
};

const DEFAULT_PREFERENCES: LocalAppearancePreferences = {
  theme: "system",
  uiLocale: "zh-Hans",
};

function isTheme(value: unknown): value is LocalTheme {
  return value === "light" || value === "dark" || value === "system";
}

function isUiLocale(value: unknown): value is LocalUiLocale {
  return value === "zh-Hans" || value === "zh-Hant" || value === "en";
}

function normalize(value: unknown): LocalAppearancePreferences {
  if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
  const candidate = value as Record<string, unknown>;
  return {
    theme: isTheme(candidate.theme)
      ? candidate.theme
      : DEFAULT_PREFERENCES.theme,
    uiLocale: isUiLocale(candidate.uiLocale)
      ? candidate.uiLocale
      : DEFAULT_PREFERENCES.uiLocale,
  };
}

/**
 * The local sidecar uses a fresh ephemeral HTTP origin after restart, so
 * These helpers deliberately use the local SQLite-backed API and are never
 * called by the hosted web runtime.
 */
export async function readLocalAppearancePreferences(): Promise<LocalAppearancePreferences | null> {
  if (!isDesktopLocalRuntime()) return null;
  try {
    const response = await fetch("/api/settings/appearance", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) return null;
    return normalize(await response.json());
  } catch {
    return null;
  }
}

export function writeLocalAppearancePreferences(
  patch: Partial<LocalAppearancePreferences>,
): void {
  if (!isDesktopLocalRuntime()) return;
  void fetch("/api/settings/appearance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    cache: "no-store",
    credentials: "omit",
    body: JSON.stringify(patch),
  }).catch(() => undefined);
}
