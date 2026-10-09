import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { useConfirm } from "@/hooks/use-confirm";
import { useT } from "@xue-learn/core/source/src/shared/i18n/index.tsx";
import { unitContentCache } from "@/shared/storage/unit-content-cache";
import { getDesktopBridge } from "./runtime.ts";

export function LocalMaintenancePage() {
  const t = useT();
  const { confirm } = useConfirm();
  const bridge = useMemo(() => getDesktopBridge(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function resetLocalData() {
    const accepted = await confirm({
      title: t("desktop.runtime.devResetTitle"),
      description: t("desktop.runtime.devResetConfirm"),
      confirmLabel: t("desktop.runtime.devReset"),
      variant: "destructive",
    });
    if (!accepted) return;

    setBusy(true);
    setError(undefined);
    try {
      await bridge.sidecar.resetDevelopmentData();
      await unitContentCache.clearAll();
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.location.assign("/onboarding");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5" aria-labelledby="local-maintenance-title">
      <div>
        <h2 id="local-maintenance-title" className="text-xl font-semibold">
          {t("desktop.runtime.devResetTitle")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("desktop.runtime.devResetHint")}
        </p>
      </div>

      <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5">
        <Button
          type="button"
          variant="destructive"
          disabled={busy}
          onClick={() => void resetLocalData()}
        >
          <RotateCcw className="size-4" aria-hidden />
          {busy
            ? t("desktop.runtime.devResetBusy")
            : t("desktop.runtime.devReset")}
        </Button>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
