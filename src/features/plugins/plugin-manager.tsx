import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  LoaderCircle,
  PackagePlus,
  Play,
  Puzzle,
  RefreshCw,
  Shapes,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useI18n } from "@xue-learn/core/i18n";
import type { DesktopPluginSummary } from "../../../packages/plugin-sdk/src/index";
import { desktopPluginViewPath } from "../../../packages/plugin-sdk/src/renderer";
import { getDesktopPluginsBridge, type DesktopPluginsBridge } from "./bridge";
import { pluginMessages } from "./messages";

const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

export function DesktopPluginManager({
  bridge = getDesktopPluginsBridge(),
}: {
  bridge?: DesktopPluginsBridge;
}) {
  const { locale } = useI18n();
  const copy = pluginMessages(locale);
  const [plugins, setPlugins] = useState<DesktopPluginSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mounted = useRef(false);
  const operationPending = useRef(false);

  const refresh = useCallback(async () => {
    if (!bridge || operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const next = await bridge.list();
      if (mounted.current) {
        setPlugins(next);
        setLoaded(true);
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      operationPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [bridge]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    const unsubscribe = bridge?.onChanged?.(onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
      unsubscribe?.();
    };
  }, [bridge, refresh]);

  const transitioning = plugins.some(
    (plugin) => plugin.status === "activating" || plugin.status === "stopping",
  );
  useEffect(() => {
    if (!transitioning || busy) return;
    const timer = window.setTimeout(() => {
      void refresh();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [transitioning, busy, refresh]);

  async function mutate(
    action: () => Promise<DesktopPluginSummary[] | null>,
    success: string,
  ) {
    if (!bridge || operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await action();
      if (mounted.current && next) {
        setPlugins(next);
        setLoaded(true);
        setNotice(success);
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : copy.actionFailed);
      // Activation can fail after changing persisted state. Reconcile before
      // showing controls again, while preserving the original action error.
      try {
        const next = await bridge.list();
        if (mounted.current) {
          setPlugins(next);
          setLoaded(true);
        }
      } catch {
        /* The action error remains visible and Refresh remains available. */
      }
    } finally {
      operationPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const locked = busy || transitioning;

  return (
    <section
      className="space-y-5"
      aria-labelledby="desktop-plugins-title"
      aria-busy={busy}
    >
      <header className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <Puzzle className="size-5" aria-hidden />
            </span>
            <div>
              <h2 id="desktop-plugins-title" className="text-xl font-semibold">
                {copy.title}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {copy.description}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              className={secondaryButton}
              disabled={!bridge || busy}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-4" aria-hidden />
              {copy.refresh}
            </button>
            <button
              type="button"
              className={primaryButton}
              disabled={!bridge || locked}
              onClick={() =>
                bridge &&
                void mutate(() => bridge.install(), copy.installedNotice)
              }
            >
              <PackagePlus className="size-4" aria-hidden />
              {copy.install}
            </button>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {copy.installHint}
        </p>
      </header>

      {!bridge && (
        <p
          role="status"
          className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground"
        >
          {copy.unavailable}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="break-words rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl border bg-muted/30 p-3 text-sm">
          {notice}
        </p>
      )}
      {busy && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          {loaded ? copy.working : copy.loading}
        </p>
      )}

      {bridge && loaded && plugins.length === 0 && (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <Puzzle
            className="mx-auto mb-3 size-7 text-muted-foreground"
            aria-hidden
          />
          <h3 className="font-semibold">{copy.emptyTitle}</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            {copy.emptyDescription}
          </p>
        </div>
      )}

      <div className="grid gap-4">
        {plugins.map((plugin) => {
          const { manifest } = plugin;
          const required = Object.entries(manifest.requires);
          const unavailable = plugin.missingCapabilities.length > 0;
          const views = manifest.contributes.views ?? [];
          const embeddedViews = views.filter((view) => view.entry);
          const commandViews = views.filter((view) => view.command);
          const executable = Boolean(manifest.runtime || embeddedViews.length);
          const viewCommands = new Set(commandViews.map((view) => view.command));
          const actions = [
            ...commandViews.map((view) => ({
              id: `view:${view.id}`,
              command: view.command!,
              title: view.title,
            })),
            ...manifest.contributes.commands
              .filter((command) => !command.hidden && !viewCommands.has(command.id))
              .map((command) => ({ ...command, command: command.id })),
          ];
          return (
            <article
              key={manifest.id}
              className="min-w-0 rounded-2xl border bg-card p-5 shadow-sm"
              aria-label={manifest.name}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words font-semibold">
                      {manifest.name}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      v{manifest.version}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${plugin.status === "active" ? "bg-primary/10 text-primary" : plugin.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
                    >
                      {copy[plugin.status]}
                    </span>
                  </div>
                  {manifest.description && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                      {manifest.description}
                    </p>
                  )}
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    {manifest.id}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {(!plugin.enabled || plugin.status === "failed") && (
                    <button
                      type="button"
                      disabled={locked || unavailable}
                      className={primaryButton}
                      onClick={() =>
                        bridge &&
                        void mutate(
                          () => bridge.enable(manifest.id),
                          copy.enabledNotice,
                        )
                      }
                    >
                      {plugin.enabled
                        ? copy.retry
                        : executable
                          ? copy.trustEnable
                          : copy.enable}
                    </button>
                  )}
                  {plugin.enabled && (
                    <button
                      type="button"
                      disabled={locked}
                      className={secondaryButton}
                      onClick={() =>
                        bridge &&
                        void mutate(
                          () => bridge.disable(manifest.id),
                          copy.disabledNotice,
                        )
                      }
                    >
                      {copy.disable}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={locked || plugin.enabled}
                    title={plugin.enabled ? copy.removeHint : undefined}
                    className={secondaryButton}
                    onClick={() =>
                      bridge &&
                      void mutate(
                        () => bridge.remove(manifest.id),
                        copy.removedNotice,
                      )
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {copy.remove}
                  </button>
                </div>
              </div>

              {required.length > 0 && (
                <dl className="mt-4 text-xs">
                  <dt className="mb-2 font-medium text-muted-foreground">
                    {copy.required}
                  </dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {required.map(([name, version]) => (
                      <span
                        key={name}
                        className="max-w-full break-all rounded-md border bg-muted/30 px-2 py-1"
                      >
                        {name} · v{version}
                      </span>
                    ))}
                  </dd>
                </dl>
              )}
              {unavailable && (
                <div className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  <p className="font-medium">{copy.missing}</p>
                  <ul className="mt-1 list-inside list-disc">
                    {plugin.missingCapabilities.map((capability) => (
                      <li key={capability} className="break-all">
                        {capability}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {plugin.error && (
                <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {plugin.error}
                </p>
              )}
              {!plugin.enabled && executable && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {copy.trustHint}
                </p>
              )}
              {!!manifest.contributes.displayPackages?.length && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {copy.displayPackages}:{" "}
                  {manifest.contributes.displayPackages.length}
                </p>
              )}

              {plugin.status === "active" && (actions.length > 0 || embeddedViews.length > 0) && (
                <div className="mt-4 border-t pt-4">
                  <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                    {copy.commands}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {embeddedViews.map((view) => locked ? (
                      <button key={view.id} type="button" disabled className={secondaryButton}>{view.title}</button>
                    ) : (
                      <Link key={view.id} to={desktopPluginViewPath(manifest.id, view.id)} className={secondaryButton}>
                        <Puzzle className="size-3.5" aria-hidden />{view.title}
                      </Link>
                    ))}
                    {actions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        disabled={locked}
                        className={secondaryButton}
                        onClick={() =>
                          bridge &&
                          void mutate(async () => {
                            await bridge.execute(manifest.id, action.command);
                            return bridge.list();
                          }, copy.executedNotice)
                        }
                      >
                        <Play className="size-3.5" aria-hidden />
                        {action.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <aside className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Shapes
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <h3 className="text-sm font-medium">{copy.displayTitle}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {copy.displayDescription}
            </p>
          </div>
        </div>
        <Link
          className={`${secondaryButton} shrink-0`}
          to="/local/display-plugins"
        >
          {copy.displayLink}
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      </aside>
    </section>
  );
}
