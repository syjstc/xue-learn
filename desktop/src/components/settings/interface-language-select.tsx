import { Languages } from "lucide-react";
import {
  getUiLocaleNativeName,
  UI_LOCALES,
  useI18n,
  type UiLocalePreference,
} from "@xue-learn/core/i18n";

/** Available before provider/model setup, so an unfamiliar language never blocks onboarding. */
export function InterfaceLanguageSelect() {
  const { locale, localePreference, setLocale, t } = useI18n();
  return (
    <label className="mb-5 ml-auto flex w-fit items-center gap-2 text-sm text-muted-foreground">
      <Languages className="size-4" aria-hidden />
      <span className="sr-only">{t("i18n.uiLanguage")}</span>
      <select
        className="native-select rounded-lg border border-border bg-card px-3 py-2 text-foreground"
        aria-label={t("i18n.uiLanguage")}
        value={localePreference ?? locale}
        onChange={(event) =>
          setLocale(event.target.value as UiLocalePreference)
        }
      >
        <option value="system">{t("i18n.systemLanguage")}</option>
        {UI_LOCALES.map((value) => (
          <option key={value} value={value}>
            {getUiLocaleNativeName(value)}
          </option>
        ))}
      </select>
    </label>
  );
}
