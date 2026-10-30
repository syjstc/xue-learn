import { Component, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useI18n } from "@xue-learn/core/i18n";
import { desktopPluginViewLaunch, type DesktopPluginRendererModule, type DesktopPluginViewLaunch } from "../../../packages/plugin-sdk/src/renderer";
import { isDesktopPluginLocalPath } from "../../../packages/plugin-sdk/src/index";
import { getDesktopPluginsBridge, type DesktopPluginsBridge } from "./bridge";
import { createPluginRendererHost } from "./renderer-host";
import { pluginMessages } from "./messages";

const loadPluginModule = (url: string): Promise<DesktopPluginRendererModule> => import(/* @vite-ignore */ url);

class PluginViewBoundary extends Component<{ children: ReactNode; onError(error: Error): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Custom plugin components mount inside the host React tree and inherit its providers and theme. */
export function DesktopPluginView({
  pluginId,
  viewId,
  bridge = getDesktopPluginsBridge(),
  loadModule = loadPluginModule,
  initialPath = "/",
  context,
  chrome = "page",
}: DesktopPluginViewLaunch & {
  pluginId: string;
  viewId: string;
  bridge?: DesktopPluginsBridge;
  loadModule?: (url: string) => Promise<DesktopPluginRendererModule>;
  chrome?: "page" | "none";
}) {
  const { locale } = useI18n();
  const copy = pluginMessages(locale);
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const currentIdentity = useRef("");
  const [state, setState] = useState<{ title?: string; View?: ComponentType; error?: string; dispose?: () => void }>({});
  const contextKey = JSON.stringify(context ?? {});

  useEffect(() => {
    let live = true;
    const unsubscribe = bridge?.onChanged?.(() => {
      void bridge.list().then(plugins => {
        if (!live) return;
        const plugin = plugins.find(item => item.manifest.id === pluginId);
        const identity = plugin ? `${plugin.status}:${plugin.manifest.version}:${plugin.viewRevision ?? ""}` : "missing";
        if (identity !== currentIdentity.current) {
          currentIdentity.current = identity;
          setRevision(value => value + 1);
        }
      }).catch(() => {
        if (live) setRevision(value => value + 1);
      });
    });
    return () => { live = false; unsubscribe?.(); };
  }, [bridge, pluginId]);
  useEffect(() => {
    let cancelled = false;
    let disposeHost: (() => void) | undefined;
    let sessionId: string | undefined;
    let stylesheet: HTMLLinkElement | undefined;
    let cancelStylesheet: (() => void) | undefined;
    const dispose = () => {
      disposeHost?.();
      disposeHost = undefined;
      cancelStylesheet?.();
      cancelStylesheet = undefined;
      stylesheet?.remove();
      stylesheet = undefined;
      if (sessionId) {
        void bridge?.closeView(sessionId).catch(() => undefined);
        sessionId = undefined;
      }
    };
    setState({});
    void (async () => {
      if (!bridge?.openView) throw Error(copy.unavailable);
      const plugin = (await bridge.list()).find(item => item.manifest.id === pluginId);
      currentIdentity.current = plugin ? `${plugin.status}:${plugin.manifest.version}:${plugin.viewRevision ?? ""}` : "missing";
      if (!plugin || plugin.status !== "active") throw Error(copy.viewInactive);
      const view = plugin.manifest.contributes.views?.find(item => item.id === viewId && item.entry);
      if (!view?.entry) throw Error(copy.viewMissing);
      if (cancelled) return;
      const session = await bridge.openView(pluginId, viewId);
      sessionId = session.sessionId;
      if (cancelled) { dispose(); return; }
      if (session.stylesheetUrl) {
        stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = session.stylesheetUrl;
        stylesheet.dataset.desktopPlugin = pluginId;
        const loaded = new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timeout);
            stylesheet!.onload = null;
            stylesheet!.onerror = null;
            cancelStylesheet = undefined;
            error ? reject(error) : resolve();
          };
          const timeout = setTimeout(() => finish(Error(copy.viewStyleFailed)), 15_000);
          stylesheet!.onload = () => finish();
          stylesheet!.onerror = () => finish(Error(copy.viewStyleFailed));
          cancelStylesheet = () => finish(Error("Plugin view closed"));
        });
        document.head.append(stylesheet);
        await loaded;
        if (cancelled) { dispose(); return; }
      }
      const runtime = createPluginRendererHost({ bridge, session, pluginId, viewId, navigate, initialPath, context: JSON.parse(contextKey) });
      disposeHost = runtime.dispose;
      const module = await loadModule(session.moduleUrl);
      if (cancelled) { dispose(); return; }
      if (typeof module.createView !== "function") throw Error(copy.viewInvalid);
      const View = module.createView(runtime.host);
      if (!View || (typeof View !== "function" && typeof View !== "object")) throw Error(copy.viewInvalid);
      setState({ title: view.title, View, dispose });
    })().catch(cause => {
      dispose();
      if (!cancelled) setState({ error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { cancelled = true; dispose(); };
  }, [bridge, pluginId, viewId, loadModule, navigate, revision, initialPath, contextKey, copy.unavailable, copy.viewInactive, copy.viewMissing, copy.viewInvalid, copy.viewStyleFailed]);

  const View = state.View;
  return (
    <section className="min-w-0 space-y-4" aria-label={state.title ?? copy.viewTitle}>
      {chrome === "page" && <header className="flex flex-wrap items-center gap-3">
        <Link to={isDesktopPluginLocalPath(context?.returnTo) ? context.returnTo : "/local/plugins"} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />{context?.returnTo ? copy.backToContent : copy.backToPlugins}
        </Link>
        {state.title && <h1 className="text-lg font-semibold">{state.title}</h1>}
      </header>}
      {state.error ? (
        <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <p className="break-words text-sm text-destructive">{state.error}</p>
          <button type="button" className="rounded-lg border bg-background px-3 py-1.5 text-sm" onClick={() => setRevision(value => value + 1)}>{copy.retry}</button>
        </div>
      ) : View ? (
        <PluginViewBoundary key={`${pluginId}:${viewId}:${revision}`} onError={error => {
          state.dispose?.();
          setState({ error: error.message });
        }}>
          <div className="min-w-0" data-desktop-plugin-content={pluginId}><View /></div>
        </PluginViewBoundary>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden />{copy.loading}</p>
      )}
    </section>
  );
}

export function LocalPluginViewPage() {
  const { pluginId = "", viewId = "" } = useParams();
  const location = useLocation();
  return <DesktopPluginView key={`${pluginId}:${viewId}`} pluginId={pluginId} viewId={viewId} {...desktopPluginViewLaunch(location.search)} />;
}
