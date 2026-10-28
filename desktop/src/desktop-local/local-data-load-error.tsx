import { HardDrive, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@xue-learn/core/ui/button";
import { useT } from "@xue-learn/core/i18n";

export function LocalDataLoadError({
  error,
  onReload = () => window.location.reload(),
}: {
  error: unknown;
  onReload?: () => void;
}) {
  const t = useT();
  const detail = error instanceof Error ? error.message : String(error);

  return (
    <main
      role="alert"
      className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-12"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_70%)] opacity-40"
        aria-hidden
      />
      <section className="relative w-full max-w-lg rounded-3xl border border-border/70 bg-card/95 p-6 shadow-lg shadow-foreground/5 sm:p-9">
        <div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <HardDrive className="size-7" aria-hidden />
        </div>

        <p className="mb-2 text-sm font-medium text-primary">
          {t("desktop.loadError.eyebrow")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t("desktop.loadError.title")}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
          {t("desktop.loadError.description")}
        </p>

        <Button
          type="button"
          size="lg"
          className="mt-7 min-w-36"
          onClick={onReload}
        >
          <RefreshCw className="size-4" aria-hidden />
          {t("desktop.loadError.reload")}
        </Button>

        <div className="mt-7 flex items-start gap-2 border-t border-border/70 pt-5 text-xs leading-5 text-muted-foreground">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden
          />
          <p>{t("desktop.loadError.dataSafe")}</p>
        </div>

        {detail ? (
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {t("desktop.loadError.showDetails")}
            </summary>
            <p className="mt-2 break-words rounded-lg bg-muted px-3 py-2 font-mono leading-5 text-foreground/70">
              {detail}
            </p>
          </details>
        ) : null}
      </section>
    </main>
  );
}
