"use client";

import { useEffect, useState } from "react";
import {
  getSelectedUnitLearningEstimate,
  useLlmSettings,
  useSaveLlmSettings,
  type LlmConfig,
} from "@/hooks/api";
import { formatGenerationEstimate as formatCredits } from "@/shared/format-number";
import {
  LiteProviderSelect,
  ProviderPicker,
  SettingsSaveFooter,
  SettingsSection,
} from "./settings-controls.tsx";
import { Label } from "@/components/ui/label";
import { useT } from "@xue-learn/core/i18n";

export function LlmSettingsForm({
  compact = false,
  lite = false,
  autoSave = false,
  showSaveFooter = true,
  productMode = false,
}: {
  compact?: boolean;
  lite?: boolean;
  autoSave?: boolean;
  showSaveFooter?: boolean;
  productMode?: boolean;
} = {}) {
  const t = useT();
  const settingsQuery = useLlmSettings();
  const saveMutation = useSaveLlmSettings();
  const [saved, setSaved] = useState(false);
  const [config, setConfig] = useState<LlmConfig | null>(null);

  useEffect(() => {
    if (settingsQuery.data && !config) {
      setConfig(settingsQuery.data.config);
    }
  }, [settingsQuery.data, config]);

  const allProviders = settingsQuery.data?.providers ?? [];
  const providers = productMode
    ? allProviders.filter((provider) => provider.configured)
    : allProviders;
  const unitLearningEstimate = getSelectedUnitLearningEstimate(
    settingsQuery.data,
    config,
  );
  const estimateRange = settingsQuery.data?.unitLearningEstimateRange;
  const estimateLabel = estimateRange
    ? estimateRange.min === estimateRange.max
      ? formatCredits(estimateRange.min)
      : `${formatCredits(estimateRange.min)}–${formatCredits(estimateRange.max)}`
    : unitLearningEstimate != null
      ? formatCredits(unitLearningEstimate)
      : null;
  const saving = saveMutation.isPending;
  const error = saveMutation.error?.message ?? settingsQuery.error?.message;

  async function persist(next: LlmConfig) {
    setSaved(false);
    try {
      const data = await saveMutation.mutateAsync(next);
      setConfig(data.config);
      setSaved(true);
    } catch {
      setConfig(settingsQuery.data?.config ?? null);
    }
  }

  async function handleSave() {
    if (!config) return;
    await persist(config);
  }

  async function updateConfig(updater: (current: LlmConfig) => LlmConfig) {
    if (!config) return;
    const next = updater(config);
    setConfig(next);
    if (autoSave) {
      await persist(next);
    }
  }

  if (settingsQuery.isPending) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.llm.loading")}
      </p>
    );
  }

  if (!config) {
    return (
      <p className="text-sm text-red-600">
        {error ?? t("settings.loadConfigFailed")}
      </p>
    );
  }

  if (providers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {productMode
          ? t("settings.advanced.aiUnavailable")
          : t("settings.llm.noPricedModels")}
      </p>
    );
  }

  if (lite) {
    return (
      <div className="space-y-2">
        {estimateLabel ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.llm.unitLearningEstimate", {
              credits: estimateLabel,
            })}
          </p>
        ) : null}
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">
            {t("settings.llm.chatProvider")}
          </Label>
          <LiteProviderSelect
            providers={providers}
            value={config.provider}
            onChange={(id) =>
              void updateConfig((c) => ({
                ...c,
                provider: id as LlmConfig["provider"],
                chatModel:
                  providers.find((p) => p.id === id)?.models[0] ?? c.chatModel,
              }))
            }
          />
        </div>
        {autoSave && error && <p className="text-xs text-red-600">{error}</p>}
        {autoSave && saved && (
          <p className="text-xs text-green-700">{t("settings.llm.saved")}</p>
        )}
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-6"}>
      {!compact && !productMode && (
        <p className="text-sm text-muted-foreground">
          {t("settings.llm.descriptionPrefix")}{" "}
          <code className="rounded bg-muted px-1 text-xs">.env</code>{" "}
          {t("settings.llm.descriptionSuffix")}
        </p>
      )}

      {estimateLabel ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.llm.unitLearningEstimate", {
            credits: estimateLabel,
          })}
        </p>
      ) : null}

      <SettingsSection
        title={t("settings.llm.chatProvider")}
        description={
          compact || productMode
            ? undefined
            : t("settings.llm.chatProviderDescription")
        }
      >
        <ProviderPicker
          providers={providers}
          value={config.provider}
          columns={compact ? "grid-cols-1 sm:grid-cols-2" : undefined}
          onChange={(id) =>
            void updateConfig((c) => ({
              ...c,
              provider: id as LlmConfig["provider"],
              chatModel:
                providers.find((p) => p.id === id)?.models[0] ?? c.chatModel,
            }))
          }
        />
      </SettingsSection>

      {showSaveFooter && !autoSave && (
        <SettingsSaveFooter
          saving={saving}
          saved={saved}
          error={error}
          onSave={() => void handleSave()}
          label={t("settings.llm.save")}
        />
      )}

      {autoSave && error && <p className="text-xs text-red-600">{error}</p>}
      {autoSave && saved && (
        <p className="text-xs text-green-700">{t("settings.llm.saved")}</p>
      )}
    </div>
  );
}
