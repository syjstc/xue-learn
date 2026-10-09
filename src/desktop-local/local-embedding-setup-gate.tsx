import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BUILTIN_EMBEDDING_MODEL_ID,
  type CredentialStatus,
  type EmbeddingModelDownloadSource,
  type EmbeddingModelInstallStatus,
  type LocalAiModelSettings,
} from "@xue-learn/core/runtime-contracts";
import { Cloud, Database, Download, LoaderCircle, Server } from "lucide-react";
import { useT } from "@xue-learn/core/i18n";
import { getDesktopBridge } from "./runtime.ts";

type Choice = "qwen" | "ollama" | "online";

function configuredFields(
  statuses: CredentialStatus[],
  providerId: string,
): readonly string[] {
  return (
    statuses.find((status) => status.providerId === providerId)
      ?.configuredFields ?? []
  );
}

export function setupComplete(
  settings: LocalAiModelSettings,
  statuses: CredentialStatus[],
  modelStatus: EmbeddingModelInstallStatus,
): boolean {
  if (settings.embeddingProvider === "builtin") {
    return (
      settings.embeddingModel === BUILTIN_EMBEDDING_MODEL_ID &&
      modelStatus.state === "installed"
    );
  }
  if (settings.embeddingProvider === "ollama") {
    return Boolean(settings.embeddingModel?.trim());
  }
  if (settings.embeddingProvider === "custom_embedding") {
    const fields = configuredFields(statuses, "custom_embedding");
    return (
      Boolean(settings.embeddingModel?.trim()) &&
      fields.includes("apiKey") &&
      fields.includes("baseUrl")
    );
  }
  return false;
}

async function loadSettings(): Promise<LocalAiModelSettings> {
  const response = await fetch("/api/local/ai-models");
  if (!response.ok) {
    throw new Error(`Embedding settings request failed (${response.status})`);
  }
  return response.json() as Promise<LocalAiModelSettings>;
}

export function LocalEmbeddingSetupGate({ children }: { children: ReactNode }) {
  const t = useT();
  const bridge = useMemo(() => getDesktopBridge(), []);
  const [loading, setLoading] = useState(true);
  const [complete, setComplete] = useState(false);
  const [choice, setChoice] = useState<Choice>("qwen");
  const [source, setSource] =
    useState<EmbeddingModelDownloadSource>("modelscope");
  const [modelStatus, setModelStatus] = useState<EmbeddingModelInstallStatus>();
  const [ollamaModel, setOllamaModel] = useState(
    "hf.co/Qwen/Qwen3-Embedding-0.6B-GGUF:Q8_0",
  );
  const [onlineUrl, setOnlineUrl] = useState("");
  const [onlineModel, setOnlineModel] = useState("");
  const [onlineKey, setOnlineKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    const [settings, statuses, nextModelStatus] = await Promise.all([
      loadSettings(),
      bridge.credentials.getStatuses(),
      bridge.embeddingModel.getStatus(),
    ]);
    setModelStatus(nextModelStatus);
    setComplete(setupComplete(settings, statuses, nextModelStatus));
  }

  useEffect(() => {
    void refresh()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (modelStatus?.state !== "downloading") return;
    const timer = window.setInterval(() => {
      void bridge.embeddingModel.getStatus().then(setModelStatus);
    }, 500);
    return () => window.clearInterval(timer);
  }, [bridge, modelStatus?.state]);

  useEffect(() => {
    if (modelStatus?.state !== "installed" || complete) return;
    // Electron marks the install complete only after the restarted sidecar has
    // selected the verified built-in model and queued its fresh index.
    setComplete(true);
  }, [complete, modelStatus?.state]);

  async function installQwen() {
    setBusy(true);
    setError(undefined);
    try {
      setModelStatus(await bridge.embeddingModel.install(source));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveRemote(
    providerId: "ollama" | "custom_embedding",
    model: string,
  ) {
    setBusy(true);
    setError(undefined);
    try {
      if (providerId === "custom_embedding") {
        const url = new URL(onlineUrl.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          throw new Error(t("desktop.embeddingSetup.invalidUrl"));
        }
      }
      const response = await fetch("/api/local/ai-models", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capability: "embedding",
          providerId,
          model: model.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(
          t("desktop.embeddingSetup.saveFailed", { status: response.status }),
        );
      }
      if (providerId === "custom_embedding") {
        await bridge.credentials.mutate({
          action: "set",
          providerId,
          values: { apiKey: onlineKey.trim(), baseUrl: onlineUrl.trim() },
        });
      }
      setComplete(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <LoaderCircle
          className="size-6 animate-spin text-primary"
          aria-label={t("desktop.embeddingSetup.checking")}
        />
      </main>
    );
  }
  if (complete) return children;

  const progress = modelStatus
    ? Math.min(
        100,
        (modelStatus.downloadedBytes / modelStatus.totalBytes) * 100,
      )
    : 0;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,var(--course-content-surface-accent),var(--background)_45%)] px-5 py-10 text-foreground">
      <section className="mx-auto max-w-4xl rounded-3xl border border-border bg-card p-6 shadow-xl sm:p-9">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-primary">
            {t("desktop.embeddingSetup.firstUse")}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {t("desktop.embeddingSetup.title")}
          </h1>
          <p className="mt-3 leading-7 text-muted-foreground">
            {t("desktop.embeddingSetup.description")}
          </p>
        </div>

        <div className="mt-7 grid gap-3 md:grid-cols-3">
          {(
            [
              [
                "qwen",
                Database,
                t("desktop.embeddingSetup.qwen"),
                t("desktop.embeddingSetup.qwenHint"),
              ],
              [
                "ollama",
                Server,
                "Ollama",
                t("desktop.embeddingSetup.ollamaHint"),
              ],
              [
                "online",
                Cloud,
                t("desktop.embeddingSetup.online"),
                t("desktop.embeddingSetup.onlineHint"),
              ],
            ] as const
          ).map(([id, Icon, title, description]) => (
            <button
              key={id}
              type="button"
              className={`rounded-2xl border p-4 text-left transition-colors ${
                choice === id
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : "border-border hover:bg-muted/50"
              }`}
              onClick={() => setChoice(id)}
            >
              <Icon className="size-5 text-primary" aria-hidden />
              <strong className="mt-3 block">{title}</strong>
              <span className="mt-1 block text-sm text-muted-foreground">
                {description}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-background p-5">
          {choice === "qwen" ? (
            <div>
              <h2 className="font-semibold">Qwen3-Embedding-0.6B Q8</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("desktop.embeddingSetup.qwenSize")}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  {t("desktop.embeddingSetup.downloadSource")}
                  <select
                    className="native-select mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5"
                    value={source}
                    onChange={(event) =>
                      setSource(
                        event.target.value as EmbeddingModelDownloadSource,
                      )
                    }
                  >
                    <option value="modelscope">
                      {t("desktop.embeddingSetup.modelscope")}
                    </option>
                    <option value="huggingface">
                      {t("desktop.embeddingSetup.huggingface")}
                    </option>
                  </select>
                </label>
              </div>
              {modelStatus?.state === "downloading" ? (
                <div className="mt-4">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("desktop.embeddingSetup.downloaded", {
                      downloaded: (
                        modelStatus.downloadedBytes /
                        1024 /
                        1024
                      ).toFixed(0),
                      total: (modelStatus.totalBytes / 1024 / 1024).toFixed(0),
                    })}
                  </p>
                </div>
              ) : null}
              <button
                type="button"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50"
                disabled={busy || modelStatus?.state === "downloading"}
                onClick={() => void installQwen()}
              >
                {modelStatus?.state === "downloading" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {modelStatus?.state === "failed"
                  ? t("desktop.embeddingSetup.retry")
                  : t("desktop.embeddingSetup.downloadUse")}
              </button>
            </div>
          ) : choice === "ollama" ? (
            <div>
              <h2 className="font-semibold">
                {t("desktop.embeddingSetup.ollamaTitle")}
              </h2>
              <label className="mt-4 block text-sm font-medium">
                {t("desktop.embeddingSetup.modelName")}
                <input
                  className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5"
                  value={ollamaModel}
                  onChange={(event) => setOllamaModel(event.target.value)}
                  placeholder="hf.co/Qwen/Qwen3-Embedding-0.6B-GGUF:Q8_0"
                />
              </label>
              <button
                type="button"
                className="mt-5 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50"
                disabled={busy || !ollamaModel.trim()}
                onClick={() => void saveRemote("ollama", ollamaModel)}
              >
                {t("desktop.embeddingSetup.saveContinue")}
              </button>
            </div>
          ) : (
            <div>
              <h2 className="font-semibold">
                {t("desktop.embeddingSetup.onlineTitle")}
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium sm:col-span-2">
                  {t("desktop.embeddingSetup.baseUrl")}
                  <input
                    type="url"
                    className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5"
                    value={onlineUrl}
                    onChange={(event) => setOnlineUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </label>
                <label className="text-sm font-medium">
                  {t("desktop.embeddingSetup.model")}
                  <input
                    className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5"
                    value={onlineModel}
                    onChange={(event) => setOnlineModel(event.target.value)}
                    placeholder="text-embedding-model"
                  />
                </label>
                <label className="text-sm font-medium">
                  {t("desktop.embeddingSetup.apiKey")}
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5"
                    value={onlineKey}
                    onChange={(event) => setOnlineKey(event.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="mt-5 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50"
                disabled={
                  busy ||
                  !onlineUrl.trim() ||
                  !onlineModel.trim() ||
                  !onlineKey.trim()
                }
                onClick={() => void saveRemote("custom_embedding", onlineModel)}
              >
                {t("desktop.embeddingSetup.saveContinue")}
              </button>
            </div>
          )}
          {error || modelStatus?.error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error ?? modelStatus?.error}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
