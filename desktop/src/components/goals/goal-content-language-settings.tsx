import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateGoalSettings } from "@/hooks/api";
import {
  CONTENT_LANGUAGES,
  getContentLanguageLabel,
} from "@/shared/i18n/content-language";
import { useT } from "@xue-learn/core/i18n";

const OPTIONS = CONTENT_LANGUAGES.map((code) => ({
  value: code,
  label: getContentLanguageLabel(code),
}));

export function GoalContentLanguageSettings({
  goalId,
  contentLanguage,
}: {
  goalId: string;
  contentLanguage?: string | null;
}) {
  const t = useT();
  const updateGoalSettings = useUpdateGoalSettings();
  const [value, setValue] = useState(contentLanguage || "zh-Hans");
  const [error, setError] = useState("");

  useEffect(() => {
    if (contentLanguage && contentLanguage !== "auto") setValue(contentLanguage);
  }, [contentLanguage]);

  async function save(next: string) {
    const previous = value;
    setValue(next);
    setError("");
    try {
      const result = await updateGoalSettings.mutateAsync({
        goalId,
        contentLanguage: next,
      });
      if (result.contentLanguage) setValue(result.contentLanguage);
    } catch (cause) {
      setValue(previous);
      setError(
        cause instanceof Error
          ? cause.message
          : t("goalDetail.courseSettings.languageSaveFailed"),
      );
    }
  }

  return (
    <section className="border-b border-[var(--border-200)] py-5">
      <div className="flex items-start gap-3">
        <Languages className="mt-0.5 size-5 shrink-0 text-[var(--brand-600)]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--text-800)]">
            {t("goalDetail.courseSettings.contentLanguage")}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-500)]">
            {t("goalDetail.courseSettings.contentLanguageDescription")}
          </p>
          <div className="mt-3 max-w-sm space-y-1.5">
            <Label htmlFor={`goal-content-language-${goalId}`}>
              {t("goalDetail.courseSettings.contentLanguageLabel")}
            </Label>
            <Select
              items={OPTIONS}
              value={value}
              disabled={updateGoalSettings.isPending}
              onValueChange={(next) => {
                if (next && next !== value) void save(next);
              }}
            >
              <SelectTrigger id={`goal-content-language-${goalId}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--text-400)]">
              {t("goalDetail.courseSettings.contentLanguageImpact")}
            </p>
            {error ? <p className="text-xs text-[var(--danger)]">{error}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
