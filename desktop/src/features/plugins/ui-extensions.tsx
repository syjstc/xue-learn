import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookOpen,
  ChartNoAxesCombined,
  Clapperboard,
  LoaderCircle,
  Play,
  Puzzle,
  Settings2,
  Sparkles,
} from "lucide-react";
import { buttonVariants } from "@xue-learn/core/ui/button";
import { cn } from "@xue-learn/core/utils";
import {
  resolveDesktopPluginUiPath,
  type DesktopPluginSummary,
  type DesktopPluginUiContext,
  type DesktopPluginUiContribution,
  type DesktopPluginUiIcon,
  type DesktopPluginUiSlot,
} from "../../../packages/plugin-sdk/src/index";
import {
  desktopPluginSettingsTabId,
  desktopPluginViewPath,
} from "../../../packages/plugin-sdk/src/renderer";
import { getDesktopPluginsBridge, type DesktopPluginsBridge } from "./bridge";
import { DesktopPluginView } from "./plugin-view";

export const pluginUiIcons: Record<DesktopPluginUiIcon, typeof Puzzle> = {
  puzzle: Puzzle,
  video: Clapperboard,
  settings: Settings2,
  book: BookOpen,
  sparkles: Sparkles,
  chart: ChartNoAxesCombined,
  play: Play,
};

export type PluginUiExtension = {
  key: string;
  pluginId: string;
  pluginName: string;
  revision: string;
  contribution: DesktopPluginUiContribution;
};
type UiRegistry = {
  entries: PluginUiExtension[];
  ready: boolean;
  bridge?: DesktopPluginsBridge;
};
const emptyRegistry: UiRegistry = { entries: [], ready: true };
const PluginUiContext = createContext<UiRegistry>(emptyRegistry);

/** One subscription owns all placements. No plugin code runs merely to list its UI. */
export function DesktopPluginUiProvider({
  children,
  bridge = getDesktopPluginsBridge(),
}: PropsWithChildren<{ bridge?: DesktopPluginsBridge }>) {
  const [plugins, setPlugins] = useState<DesktopPluginSummary[]>([]);
  const [ready, setReady] = useState(!bridge);
  useEffect(() => {
    let live = true;
    let request = 0;
    setPlugins([]);
    setReady(!bridge);
    const refresh = async () => {
      if (!bridge) return;
      const revision = ++request;
      try {
        const next = await bridge.list();
        if (live && revision === request) {
          setPlugins(next);
          setReady(true);
        }
      } catch {
        // Stale placements must not survive a failed lifecycle reconciliation.
        if (live && revision === request) {
          setPlugins([]);
          setReady(true);
        }
      }
    };
    const changed = () => {
      void refresh();
    };
    const unsubscribe = bridge?.onChanged?.(changed);
    window.addEventListener("focus", changed);
    void refresh();
    return () => {
      live = false;
      unsubscribe?.();
      window.removeEventListener("focus", changed);
    };
  }, [bridge]);
  const registry = useMemo<UiRegistry>(
    () => ({
      ready,
      bridge,
      entries: plugins
        .filter(
          (plugin) =>
            plugin.enabled &&
            plugin.status === "active" &&
            !plugin.missingCapabilities.length,
        )
        .flatMap((plugin) =>
          (plugin.manifest.contributes.ui ?? []).map((contribution) => ({
            key: desktopPluginSettingsTabId(
              plugin.manifest.id,
              contribution.id,
            ),
            pluginId: plugin.manifest.id,
            pluginName: plugin.manifest.name,
            revision: `${plugin.manifest.version}:${plugin.viewRevision ?? ""}`,
            contribution,
          })),
        )
        .sort(
          (a, b) =>
            (a.contribution.order ?? 0) - (b.contribution.order ?? 0) ||
            a.key.localeCompare(b.key),
        ),
    }),
    [plugins, ready, bridge],
  );
  return (
    <PluginUiContext.Provider value={registry}>
      {children}
    </PluginUiContext.Provider>
  );
}

export function useDesktopPluginUi() {
  return useContext(PluginUiContext);
}

function PluginAction({
  entry,
  context,
  initialPath,
  bridge,
}: {
  entry: PluginUiExtension;
  context: DesktopPluginUiContext;
  initialPath: string;
  bridge?: DesktopPluginsBridge;
}) {
  const { contribution, pluginId } = entry;
  const Icon = pluginUiIcons[contribution.icon ?? "puzzle"];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const className = cn(
    buttonVariants({ variant: "outline", size: "sm" }),
    "max-w-full",
  );
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{contribution.title}</span>
    </>
  );
  if (contribution.viewId)
    return (
      <Link
        className={className}
        title={contribution.description}
        to={desktopPluginViewPath(pluginId, contribution.viewId, {
          initialPath,
          context,
        })}
      >
        {content}
      </Link>
    );
  return (
    <div className="min-w-0">
      <button
        type="button"
        className={className}
        disabled={busy || !bridge}
        title={contribution.description}
        onClick={() => {
          if (!bridge || pending.current) return;
          pending.current = true;
          setBusy(true);
          setError(undefined);
          void bridge
            .execute(pluginId, contribution.command!, { context })
            .catch((cause) => {
              if (mounted.current)
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
            })
            .finally(() => {
              pending.current = false;
              if (mounted.current) setBusy(false);
            });
        }}
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          content
        )}
      </button>
      {error && (
        <p
          role="alert"
          className="mt-1 max-w-sm break-words text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Placements use the same view loader, workspace session and failure boundary as plugin pages. */
export function DesktopPluginSlot({
  slot,
  context = {},
  className,
}: {
  slot: Exclude<DesktopPluginUiSlot, "settings.tabs">;
  context?: DesktopPluginUiContext;
  className?: string;
}) {
  const { entries, bridge } = useDesktopPluginUi();
  const placements = entries.filter(
    (entry) => entry.contribution.slot === slot,
  );
  if (!placements.length) return null;
  return (
    <ActivePluginSlot
      slot={slot}
      context={context}
      className={className}
      entries={placements}
      bridge={bridge}
    />
  );
}

function ActivePluginSlot({
  slot,
  context,
  className,
  entries,
  bridge,
}: {
  slot: Exclude<DesktopPluginUiSlot, "settings.tabs">;
  context: DesktopPluginUiContext;
  className?: string;
  entries: PluginUiExtension[];
  bridge?: DesktopPluginsBridge;
}) {
  const location = useLocation();
  const launchContext = {
    ...context,
    slot,
    returnTo: location.pathname + location.search + location.hash,
  };
  const matches = entries
    .map((entry) => ({
      entry,
      path: resolveDesktopPluginUiPath(entry.contribution.path, launchContext),
    }))
    .filter(
      (item): item is { entry: PluginUiExtension; path: string } =>
        item.path !== undefined,
    );
  if (!matches.length) return null;
  const panels = slot === "unit.content.panels";
  return (
    <div
      data-desktop-plugin-slot={slot}
      className={cn(
        panels ? "min-w-0 space-y-4" : "flex flex-wrap items-center gap-2",
        className,
      )}
    >
      {matches.map(({ entry, path }) =>
        panels ? (
          <DesktopPluginView
            key={`${entry.key}:${entry.revision}`}
            pluginId={entry.pluginId}
            viewId={entry.contribution.viewId!}
            initialPath={path}
            context={launchContext}
            chrome="none"
            bridge={bridge}
          />
        ) : (
          <PluginAction
            key={`${entry.key}:${entry.revision}`}
            entry={entry}
            context={launchContext}
            initialPath={path}
            bridge={bridge}
          />
        ),
      )}
    </div>
  );
}
