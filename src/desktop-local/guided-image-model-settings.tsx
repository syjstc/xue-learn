import { useEffect, useState } from "react";
import {
  localChatProviderIds,
  type CodexModelCatalog,
  type GuidedImageModelSettings,
  type LocalAiModelSettings,
} from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { apiPatch } from "@/shared/api";
import {
  LOCAL_CHAT_PROVIDER_PRESETS,
  LOCAL_DEFAULT_MODELS,
} from "./local-provider-catalog.ts";

export function GuidedImageModelSettingsPanel({
  settings,
  catalog,
  onSaved,
}: {
  settings: LocalAiModelSettings;
  catalog?: CodexModelCatalog;
  onSaved: (settings: LocalAiModelSettings) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [providerId, setProviderId] = useState(settings.chatProvider);
  const [model, setModel] = useState(settings.chatModel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const stored = settings.guidedImageModel;
    setMode(stored?.mode ?? "auto");
    setProviderId(
      stored?.mode === "manual" ? stored.providerId : settings.chatProvider,
    );
    setModel(stored?.mode === "manual" ? stored.model : settings.chatModel);
  }, [settings.guidedImageModel, settings.chatProvider, settings.chatModel]);

  const choices =
    providerId === "codex"
      ? (catalog?.models.map((item) => item.id) ?? [])
      : (LOCAL_DEFAULT_MODELS.chat[providerId] ?? []);
  const save = async () => {
    setSaving(true);
    setError(undefined);
    setSaved(false);
    const selection: GuidedImageModelSettings =
      mode === "auto" ? { mode } : { mode, providerId, model: model.trim() };
    try {
      onSaved(
        await apiPatch<LocalAiModelSettings>("/api/local/ai-models", {
          capability: "guided_image",
          settings: selection,
        }),
      );
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="mt-6 space-y-3 border-t pt-5"
      aria-labelledby="guided-image-model-title"
    >
      <h3 id="guided-image-model-title" className="text-sm font-semibold">
        {t("desktop.guidedImageModel.title")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("desktop.guidedImageModel.description")}
      </p>
      <div className="max-w-xl space-y-3">
        <Label htmlFor="guided-image-model-mode">
          {t("desktop.guidedImageModel.mode")}
        </Label>
        <select
          id="guided-image-model-mode"
          value={mode}
          disabled={saving}
          className="native-select h-10 w-full rounded-md border bg-background px-3 text-sm"
          onChange={(event) => {
            setMode(event.target.value as "auto" | "manual");
            setSaved(false);
          }}
        >
          <option value="auto">{t("desktop.guidedImageModel.auto")}</option>
          <option value="manual">{t("desktop.guidedImageModel.manual")}</option>
        </select>
        {mode === "auto" ? (
          <p className="text-xs text-muted-foreground">
            {t("desktop.guidedImageModel.current", {
              model: settings.chatModel,
            })}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="guided-image-model-provider">
                  {t("desktop.guidedImageModel.provider")}
                </Label>
                <select
                  id="guided-image-model-provider"
                  value={providerId}
                  disabled={saving}
                  className="native-select h-10 w-full rounded-md border bg-background px-3 text-sm"
                  onChange={(event) => {
                    const next = event.target.value as typeof providerId;
                    setProviderId(next);
                    setModel(
                      next === settings.chatProvider
                        ? settings.chatModel
                        : next === "codex"
                          ? (catalog?.models[0]?.id ?? "")
                          : (LOCAL_DEFAULT_MODELS.chat[next]?.[0] ?? ""),
                    );
                    setSaved(false);
                  }}
                >
                  {localChatProviderIds.map((id) => (
                    <option key={id} value={id}>
                      {LOCAL_CHAT_PROVIDER_PRESETS[id]?.label ?? id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="guided-image-model-name">
                  {t("desktop.guidedImageModel.model")}
                </Label>
                <Input
                  id="guided-image-model-name"
                  list="guided-image-model-choices"
                  value={model}
                  maxLength={200}
                  disabled={saving}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setSaved(false);
                  }}
                />
                <datalist id="guided-image-model-choices">
                  {choices.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("desktop.guidedImageModel.manualHint")}
            </p>
          </>
        )}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            disabled={saving || (mode === "manual" && !model.trim())}
            onClick={() => void save()}
          >
            {t(
              saving
                ? "desktop.guidedImageModel.saving"
                : "desktop.guidedImageModel.save",
            )}
          </Button>
          {saved ? (
            <span role="status" className="text-sm text-muted-foreground">
              {t("desktop.guidedImageModel.saved")}
            </span>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
