import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {createDisplayCatalog, createDisplayRuntime, displayPluginKey, validateDisplayDocument, type DisplayDocument, type DisplayNode, type DisplayPluginManifest, type DisplayRuntime} from "../../../libs/display/src/index.js";
import {createBrowserDisplayResourceResolver, DisplayPlaceholder, DisplayRuntimeSurface, type DisplayRenderer, type DisplayRuntimeSurfaceProps} from "../display-runtime/index.js";
import {builtinDisplayManifests} from "../display-plugins/catalog.js";
import {DISPLAY_PLUGINS_ENDPOINT, type DisplayPluginRecord, type DisplayWorkspaceClient} from "./plugin-manager.js";

export function createWorkspaceDisplayRuntime(): DisplayRuntime<DisplayRenderer> {
  return createDisplayRuntime<DisplayRenderer>({catalog: createDisplayCatalog(builtinDisplayManifests),
    resolveModule: async manifest => (await import("../display-plugins/index.js")).loadBuiltinDisplayModule(manifest),
    resolveResource: createBrowserDisplayResourceResolver()});
}
type WorkspaceContext = {
  runtime: DisplayRuntime<DisplayRenderer>;
  client?: DisplayWorkspaceClient;
  ready: boolean;
  error?: string;
  refresh: () => Promise<void>;
};
const Context = createContext<WorkspaceContext | null>(null);

function useOwnedDisplayRuntime(suppliedRuntime?: DisplayRuntime<DisplayRenderer>): DisplayRuntime<DisplayRenderer> {
  const runtime = useMemo(() => suppliedRuntime ?? createWorkspaceDisplayRuntime(), [suppliedRuntime]);
  const pending = useRef(new Map<DisplayRuntime<DisplayRenderer>, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timer = pending.current.get(runtime);
    if (timer !== undefined) {clearTimeout(timer); pending.current.delete(runtime);}
    if (suppliedRuntime) return;
    return () => {
      // StrictMode immediately repeats effect setup with the same runtime. A real
      // unmount or replacement still releases loaders, fonts and blob URLs.
      const timer = setTimeout(() => {pending.current.delete(runtime); runtime.dispose();}, 0);
      pending.current.set(runtime, timer);
    };
  }, [runtime, suppliedRuntime]);
  return runtime;
}

export function DisplayWorkspaceProvider({children, client, runtime: suppliedRuntime}: {children: ReactNode; client?: DisplayWorkspaceClient; runtime?: DisplayRuntime<DisplayRenderer>}) {
  const runtime = useOwnedDisplayRuntime(suppliedRuntime);
  const [ready, setReady] = useState(!client);
  const [error, setError] = useState<string>();
  const installed = useRef<{runtime: DisplayRuntime<DisplayRenderer>; entries: Map<string, {manifest: DisplayPluginManifest; dispose: () => void}>} | undefined>(undefined);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    if (!client) {setReady(true); return;}
    try {
      const packages = await client.get<readonly DisplayPluginRecord[]>(DISPLAY_PLUGINS_ENDPOINT);
      if (request !== epoch.current) return;
      if (!Array.isArray(packages)) throw new Error("Display plugin response must be a list");
      const manifests = packages.filter(item => !item.builtin).map(item => item.manifest);
      // Validate the complete replacement before touching the live registry.
      const previous = installed.current?.runtime === runtime ? installed.current.entries : new Map<string, {manifest: DisplayPluginManifest; dispose: () => void}>();
      createDisplayCatalog([...runtime.catalog.list().filter(manifest => !previous.has(displayPluginKey(manifest.id, manifest.version))), ...manifests]);
      const next = new Map(manifests.map(manifest => [displayPluginKey(manifest.id, manifest.version), manifest]));
      for (const [key, entry] of previous) if (!next.has(key) || JSON.stringify(next.get(key)) !== JSON.stringify(entry.manifest)) {entry.dispose(); previous.delete(key);}
      for (const [key, manifest] of next) if (!previous.has(key)) previous.set(key, {manifest, dispose: runtime.catalog.register(manifest)});
      installed.current = {runtime, entries: previous};
      setError(undefined); setReady(true);
    } catch (failure) {
      if (request !== epoch.current) return;
      setError(failure instanceof Error ? failure.message : String(failure)); setReady(true);
      throw failure;
    }
  }, [client, runtime]);
  useEffect(() => {
    setReady(!client); void refresh().catch(() => {});
    return () => {epoch.current++; installed.current?.entries.forEach(entry => entry.dispose()); installed.current = undefined;};
  }, [refresh, client]);
  const context = useMemo(() => ({runtime, client, ready, error, refresh}), [runtime, client, ready, error, refresh]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

/** Standalone galleries get their own runtime; application hosts use the provider. */
export function useDisplayWorkspace(): WorkspaceContext {
  const context = useContext(Context);
  const runtime = useOwnedDisplayRuntime(context?.runtime);
  return context ?? {runtime, ready: true, refresh: async () => {}};
}
export const useDisplayWorkspaceRuntime = () => useDisplayWorkspace().runtime;
/** Preview registries stay independent from the live course workspace. */
export const useDisplayPreviewRuntime = () => useOwnedDisplayRuntime();

function nodes(root: unknown): DisplayNode[] {
  const result: DisplayNode[] = [], queue = [root], seen = new Set<DisplayNode>();
  while (queue.length && result.length < 10_000) {
    const node = queue.pop() as DisplayNode | undefined;
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node); result.push(node);
    const enqueue = (children: readonly unknown[]) => {
      const remaining = Math.max(0, 10_000 - result.length - queue.length);
      for (let index = 0; index < Math.min(children.length, remaining); index++) queue.push(children[index]);
    };
    if (Array.isArray(node.children)) enqueue(node.children);
    if (node.slots && typeof node.slots === "object") for (const children of Object.values(node.slots)) if (Array.isArray(children)) enqueue(children);
  }
  return result;
}

/** A pending document is projected from durable jobs. The renderer never starts a
 * generation task, and a projection cannot replace a different source revision. */
export function WorkspaceDisplaySurface(props: Omit<DisplayRuntimeSurfaceProps, "runtime"> & {runtime?: DisplayRuntime<DisplayRenderer>; onDocumentResolved?: (document: DisplayDocument) => void}) {
  const workspace = useDisplayWorkspace();
  const [projected, setProjected] = useState<{source: DisplayDocument; document: DisplayDocument}>();
  const [projectionError, setProjectionError] = useState<{source: DisplayDocument; message: string}>();
  const [refreshKey, setRefreshKey] = useState(0);
  const source = props.document;
  const currentSource = useRef(source);
  currentSource.current = source;
  const projectionEpoch = useRef(0);
  const retryRequests = useRef(new Set<string>());
  const document = projected?.source === source ? projected.document : source;
  const sourceIssues = useMemo(() => validateDisplayDocument(source), [source]);
  const notifyResolved = useRef(props.onDocumentResolved);
  notifyResolved.current = props.onDocumentResolved;
  useEffect(() => {if (!sourceIssues.length) notifyResolved.current?.(document);}, [document, sourceIssues]);
  const sourceJobs = useMemo(() => sourceIssues.length ? [] : nodes(source?.root).filter(node => node.build && node.build.status !== "ready"), [source, sourceIssues]);
  useEffect(() => {
    const epoch = ++projectionEpoch.current;
    if (!workspace.client || !sourceJobs.length) return () => {projectionEpoch.current++;};
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await workspace.client!.post<DisplayDocument>("/api/local/display-builds/resolve", {document: source});
        if (cancelled || projectionEpoch.current !== epoch || currentSource.current !== source) return;
        const issues = validateDisplayDocument(next);
        if (issues.length || next.id !== source.id || next.root.id !== source.root.id) throw new Error("展示构建返回了不匹配的内容。");
        const nextNodes = new Map(nodes(next.root).map(node => [node.id, node]));
        for (const original of sourceJobs) {
          const nextNode = nextNodes.get(original.id);
          const ref = nextNode?.build;
          if (!nextNode || !ref || nextNode.kind !== original.kind || nextNode.version !== original.version || ref.jobId !== original.build!.jobId || ref.sourceHash !== original.build!.sourceHash || ref.revision !== original.build!.revision) throw new Error("展示输入已改变，忽略旧构建结果。");
        }
        setProjected({source, document: next}); setProjectionError(undefined);
        if (nodes(next.root).some(node => node.build && ["pending", "running"].includes(node.build.status))) timer = setTimeout(poll, 1500);
      } catch (failure) {
        if (cancelled || projectionEpoch.current !== epoch || currentSource.current !== source) return;
        setProjectionError({source, message: failure instanceof Error ? failure.message : String(failure)});
        timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {cancelled = true; projectionEpoch.current++; clearTimeout(timer);};
  }, [workspace.client, source, sourceJobs, refreshKey]);
  if (!workspace.ready) return <DisplayPlaceholder failure={{reason: "loading", message: "正在加载工作区展示插件"}}/>;
  return <div className="workspace-display-host">
    <DisplayRuntimeSurface {...props} document={document} runtime={props.runtime ?? workspace.runtime} fallback={props.fallback ?? ((failure, retry) => {
      const node = nodes(document?.root).find(candidate => candidate.id === failure.nodeId);
      const retryBuild = failure.reason === "build-failed" && node?.build && workspace.client;
      return <DisplayPlaceholder failure={failure} onRetry={props.mode === "video" ? undefined : () => {
        const epoch = projectionEpoch.current;
        const isCurrent = () => projectionEpoch.current === epoch && currentSource.current === source;
        if (retryBuild) {
          const jobId = node!.build!.jobId;
          if (retryRequests.current.has(jobId)) return;
          retryRequests.current.add(jobId);
          void workspace.client!.post(`/api/local/display-builds/${encodeURIComponent(jobId)}/retry`, {}).then(() => {if (isCurrent()) setRefreshKey(key => key + 1);})
            .catch(error => {if (isCurrent()) setProjectionError({source, message: String(error?.message ?? error)});}).finally(() => retryRequests.current.delete(jobId));
        } else {void workspace.refresh().then(() => {if (isCurrent()) retry();}).catch(error => {if (isCurrent()) setProjectionError({source, message: String(error?.message ?? error)});});}
      }}/>;
    })}/>
    {projectionError?.source === source && props.mode !== "video" ? <p role="status" className="workspace-display-status">展示内容更新失败：{projectionError.message}</p> : null}
  </div>;
}
