import { useEffect, useState } from "react";
import { Database, Save } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet, apiPatch } from "@/shared/api";
import { useT } from "@xue-learn/core/i18n";

type LocalResourceSettings = {
  ragMaxChunksPerUpload: number;
  limits: {
    ragMaxChunksPerUpload: { min: number; max: number };
  };
};

export function LocalResourceSettingsPage() {
  const t = useT();
  const [settings, setSettings] = useState<LocalResourceSettings>();
  const [chunkLimit, setChunkLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    void apiGet<LocalResourceSettings>("/api/local/resource-settings")
      .then((value) => {
        setSettings(value);
        setChunkLimit(String(value.ragMaxChunksPerUpload));
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, []);

  const parsedLimit = Number(chunkLimit);
  const min = settings?.limits.ragMaxChunksPerUpload.min ?? 1;
  const max = settings?.limits.ragMaxChunksPerUpload.max ?? 10_000;
  const valid =
    Number.isInteger(parsedLimit) && parsedLimit >= min && parsedLimit <= max;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const value = await apiPatch<LocalResourceSettings>(
        "/api/local/resource-settings",
        { ragMaxChunksPerUpload: parsedLimit },
      );
      setSettings(value);
      setChunkLimit(String(value.ragMaxChunksPerUpload));
      setNotice(t("desktop.resourceSettings.saved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5" aria-labelledby="local-resources-title">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-[var(--brand-50)] p-2.5 text-[var(--brand-700)]">
          <Database className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="local-resources-title" className="text-xl font-semibold">
            {t("desktop.resourceSettings.title")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("desktop.resourceSettings.description")}
          </p>
        </div>
      </div>

      <div className="max-w-2xl rounded-2xl border bg-card p-5 shadow-sm">
        <div className="space-y-2">
          <Label htmlFor="rag-max-chunks">
            {t("desktop.resourceSettings.chunkLimitLabel")}
          </Label>
          <Input
            id="rag-max-chunks"
            type="number"
            min={min}
            max={max}
            step={1}
            value={chunkLimit}
            disabled={!settings || saving}
            onChange={(event) => {
              setChunkLimit(event.target.value);
              setNotice(undefined);
            }}
            className="max-w-48"
          />
          <p className="text-sm text-muted-foreground">
            {t("desktop.resourceSettings.chunkLimitHint", { min, max })}
          </p>
          {chunkLimit && !valid ? (
            <p role="alert" className="text-sm text-destructive">
              {t("desktop.resourceSettings.chunkLimitInvalid", { min, max })}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button
            type="button"
            disabled={!settings || !valid || saving}
            onClick={() => void save()}
          >
            <Save className="mr-2 size-4" aria-hidden />
            {saving
              ? t("desktop.resourceSettings.saving")
              : t("desktop.resourceSettings.save")}
          </Button>
          {notice ? (
            <p role="status" className="text-sm text-emerald-700">
              {notice}
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
