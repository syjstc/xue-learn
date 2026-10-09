import { useEffect, useMemo, useState } from "react";
import {
  type EmbeddingModelDownloadSource,
  type EmbeddingModelInstallStatus,
} from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { Download, LoaderCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@xue-learn/core/source/src/components/ui/dialog.tsx";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { getDesktopBridge } from "./runtime.ts";

export function BuiltinEmbeddingDownloadDialog({
  open,
  status: externalStatus,
  onOpenChange,
  onStatusChange,
  onInstalled,
}: {
  open: boolean;
  status?: EmbeddingModelInstallStatus;
  onOpenChange(open: boolean): void;
  onStatusChange(status: EmbeddingModelInstallStatus): void;
  onInstalled(status: EmbeddingModelInstallStatus): void;
}) {
  const t = useT();
  const bridge = useMemo(() => getDesktopBridge(), []);
  const [source, setSource] =
    useState<EmbeddingModelDownloadSource>("modelscope");
  const [status, setStatus] = useState(externalStatus);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  function publishStatus(next: EmbeddingModelInstallStatus) {
    setStatus(next);
    onStatusChange(next);
  }

  useEffect(() => {
    if (!open) return;
    setStatus(externalStatus);
    setError(undefined);
    void bridge.embeddingModel
      .getStatus()
      .then(publishStatus)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [bridge, open]);

  useEffect(() => {
    if (!open || status?.state !== "downloading") return;
    const timer = window.setInterval(() => {
      void bridge.embeddingModel
        .getStatus()
        .then(publishStatus)
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : String(cause)),
        );
    }, 500);
    return () => window.clearInterval(timer);
  }, [bridge, open, status?.state]);

  useEffect(() => {
    if (!open || status?.state !== "installed") return;
    onInstalled(status);
  }, [open, status]);

  async function install() {
    setStarting(true);
    setError(undefined);
    try {
      publishStatus(await bridge.embeddingModel.install(source));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }

  const downloading = status?.state === "downloading";
  const progress = status
    ? Math.min(100, (status.downloadedBytes / status.totalBytes) * 100)
    : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!downloading) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={!downloading}
      >
        <DialogHeader className="border-b border-border px-6 py-5 pr-14">
          <DialogTitle className="text-xl font-semibold">
            {t("desktop.embeddingSetup.downloadTitle")}
          </DialogTitle>
          <DialogDescription className="leading-6">
            {t("desktop.embeddingSetup.downloadDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <div>
            <p className="font-semibold">Qwen3-Embedding-0.6B Q8</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("desktop.embeddingSetup.qwenSize")}
            </p>
          </div>

          <label className="block text-sm font-medium">
            {t("desktop.embeddingSetup.downloadSource")}
            <select
              className="native-select mt-1.5 w-full rounded-xl border border-border bg-card px-3 py-2.5"
              value={source}
              disabled={downloading}
              onChange={(event) =>
                setSource(event.target.value as EmbeddingModelDownloadSource)
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

          {downloading ? (
            <div aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("desktop.embeddingSetup.downloaded", {
                  downloaded: (status.downloadedBytes / 1024 / 1024).toFixed(0),
                  total: (status.totalBytes / 1024 / 1024).toFixed(0),
                })}
              </p>
            </div>
          ) : null}

          {error || status?.error ? (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error ?? status?.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              className="rounded-xl border border-border bg-background px-4 py-2.5 font-medium text-foreground disabled:opacity-50"
              disabled={downloading}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50"
              disabled={starting || downloading}
              onClick={() => void install()}
            >
              {starting || downloading ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              {status?.state === "failed"
                ? t("desktop.embeddingSetup.retry")
                : t("desktop.embeddingSetup.downloadUse")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
