export const UI_LOCALES = ["zh-Hans", "zh-Hant", "en"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export type UiLocalePreference = UiLocale | "system";

/** Match regional/script variants without mistaking an unsupported language for Chinese. */
export function supportedUiLocale(value: string): UiLocale | null {
  const tag = value.trim().replace(/_/g, "-").toLowerCase();
  if (/^en(?:-|$)/.test(tag)) return "en";
  if (!/^zh(?:-|$)/.test(tag)) return null;
  if (/^zh-hant(?:-|$)/.test(tag)) return "zh-Hant";
  if (/^zh-hans(?:-|$)/.test(tag)) return "zh-Hans";
  return /^zh-(?:tw|hk|mo)(?:-|$)/.test(tag) ? "zh-Hant" : "zh-Hans";
}

export function detectUiLocale(languages: readonly string[]): UiLocale {
  for (const language of languages) {
    const supported = supportedUiLocale(language);
    if (supported) return supported;
  }
  return "en";
}

export function getSystemUiLocale(): UiLocale {
  return detectUiLocale(
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language],
  );
}

export function resolveUiLocale(preference: UiLocalePreference): UiLocale {
  return preference === "system" ? getSystemUiLocale() : preference;
}
