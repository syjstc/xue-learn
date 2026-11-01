import { useT } from "../../shared/i18n/index.js";
import React, {Component, Suspense, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode} from "react";
import {activeDisplayTargets, createDisplayStateStore, displayComponentKey, validateDisplayDocument, type DisplayClock, type DisplayDocument, type DisplayNode, type DisplayResource, type DisplayResourceState, type DisplayRuntime, type DisplayRuntimeFailure, type DisplayState, type DisplayStateStore, type DisplayTimelineCue} from "../../../libs/display/src/index.js";
import "./display-runtime.css";

export type DisplayRendererProps<Payload = unknown> = Readonly<{
  node: DisplayNode<Payload>;
  clock: DisplayClock;
  mode: "interactive" | "video";
  viewport?: Readonly<{width: number; height: number}>;
  state: DisplayState;
  updateState: (patch: DisplayState | ((previous: DisplayState) => DisplayState)) => void;
  children: ReactNode;
  slots: Readonly<Record<string, ReactNode>>;
  resources: Readonly<Record<string, DisplayResourceState>>;
  activeTargets: readonly string[];
  timeline: readonly DisplayTimelineCue[];
}>;
export type DisplayRenderer = ComponentType<DisplayRendererProps<any>>;
export type DisplayRenderProps<Payload = unknown> = DisplayRendererProps<Payload>;
export type DisplayRuntimeSurfaceProps = Readonly<{
  document: DisplayDocument;
  runtime: DisplayRuntime<any>;
  clock: DisplayClock;
  mode?: "interactive" | "video";
  viewport?: Readonly<{width: number; height: number}>;
  state?: DisplayStateStore;
  fallback?: (failure: DisplayRuntimeFailure, retry: () => void) => ReactNode;
  onFailure?: (failure: DisplayRuntimeFailure) => void;
}>;

const failureLabels: Record<DisplayRuntimeFailure["reason"], import("../../shared/i18n/index.js").TranslationKey> = {
  loading: "display.ui.loadingDisplayComponent", building: "display.ui.preparingDisplayContent", "build-failed": "display.ui.couldNotPrepareDisplayContent",
  "missing-plugin": "display.ui.missingDisplayPlugin", "version-mismatch": "display.ui.displayPluginVersionMismatch", "invalid-document": "display.ui.invalidDisplayContent",
  "invalid-node": "display.ui.invalidDisplayComponent", "invalid-payload": "display.ui.invalidDisplayData", "invalid-slot": "display.ui.invalidDisplayComposition",
  "dependency-cycle": "display.ui.couldNotResolvePluginDependencies", "composition-cycle": "display.ui.displayCompositionContainsACycle", "load-error": "display.ui.couldNotLoadDisplayPlugin",
  "resource-error": "display.ui.displayResourcesAreNotReady", "render-error": "display.ui.thisComponentCannotBeDisplayedRightNow",
};
export function DisplayPlaceholder({failure, onRetry}: {failure: DisplayRuntimeFailure; onRetry?: () => void;
}) {
  const t = useT();
  const pending = failure.reason === "loading" || failure.reason === "building";
  return (
    <section className="xue-display-placeholder" role="status" aria-live="polite" aria-busy={pending} data-display-placeholder={failure.reason} data-display-node={failure.nodeId} data-display-kind={failure.kind} data-display-message={failure.message} data-display-plugin={failure.pluginId} data-display-resource={failure.resourceId}>
    <span className="xue-display-placeholder-symbol" aria-hidden="true">{pending ? "◌" : "◇"}</span>
    <strong>{t(failureLabels[failure.reason])}</strong>
    {!pending && onRetry && (
        <button type="button" onClick={onRetry}>{t("display.ui.retryLoading")}</button>)}
  </section>);
}

type BoundaryProps = {node: DisplayNode; revision: number; frame: number; fallback: (failure: DisplayRuntimeFailure) => ReactNode; onFailure?: (failure: DisplayRuntimeFailure) => void; children: ReactNode;
};
class DisplayNodeBoundary extends Component<BoundaryProps, {error?: unknown; failed: boolean}> {
  state: {error?: unknown; failed: boolean} = {failed: false};
  static getDerivedStateFromError(error: unknown) {return {failed: true, error};}
  componentDidCatch(error: unknown) {this.props.onFailure?.({reason: "render-error", message: "Display component failed to render", nodeId: this.props.node.id, kind: this.props.node.kind, error});}
  componentDidUpdate(previous: BoundaryProps) {if (this.state.failed && (previous.node !== this.props.node || previous.revision !== this.props.revision || previous.frame !== this.props.frame)) this.setState({failed: false, error: undefined});}
  render() {return this.state.failed ? this.props.fallback({reason: "render-error", message: "Display component failed to render", nodeId: this.props.node.id, kind: this.props.node.kind, error: this.state.error}) : this.props.children;}
}

function Failure({failure, fallback, onFailure}: {failure: DisplayRuntimeFailure; fallback: (failure: DisplayRuntimeFailure) => ReactNode; onFailure?: (failure: DisplayRuntimeFailure) => void;
}) {
  useEffect(() => {if (failure.reason !== "loading" && failure.reason !== "building") onFailure?.(failure);}, [failure.reason, failure.nodeId, failure.pluginId, failure.message, onFailure]);
  return <>{fallback(failure)}</>;
}

type NodeProps = {
  node: DisplayNode; document: DisplayDocument; runtime: DisplayRuntime<any>; clock: DisplayClock; mode: "interactive" | "video";
  viewport?: Readonly<{width: number; height: number}>; store: DisplayStateStore; revision: number;
  inheritedResources: readonly DisplayResource[]; failures: ReadonlyMap<string, DisplayRuntimeFailure>; depth: number; ancestry: readonly string[]; activeTargets: readonly string[];
  fallback: (failure: DisplayRuntimeFailure) => ReactNode; onFailure?: (failure: DisplayRuntimeFailure) => void;
};
function DisplayRuntimeNode(props: NodeProps): ReactNode {
  const {node, runtime, document, fallback, onFailure} = props;
  const structural = props.failures.get(node.id);
  if (structural) return (
      <Failure failure={structural} fallback={fallback} onFailure={onFailure}/>);
  if (props.depth > 64) return (
      <Failure failure={{reason: "composition-cycle", message: "Display nesting limit exceeded", nodeId: node.id, kind: node.kind}} fallback={fallback} onFailure={onFailure}/>);
  const resolution = runtime.resolve(node, document, props.inheritedResources);
  if (resolution.status !== "ready") return (
      <Failure failure={resolution.failure} fallback={fallback} onFailure={onFailure}/>);
  const inheritedResources = runtime.resourceScope(resolution.manifest, document, props.inheritedResources);
  const key = displayComponentKey(node.kind, node.version);
  const render = (child: DisplayNode, ancestry: readonly string[] = []): ReactNode => (
    <DisplayRuntimeNode key={`${child.id}:${child.kind}:${child.version}`}
      {...props}
      node={child}
      depth={props.depth + 1}
      ancestry={ancestry}
      inheritedResources={inheritedResources}
    />
  );
  let content: ReactNode;
  if (resolution.composition) {
    if (props.ancestry.includes(key))
      return (
        <Failure
          failure={{
            reason: "composition-cycle",
            message: `Recursive composition ${key}`,
            nodeId: node.id,
            kind: node.kind,
          }}
          fallback={fallback}
          onFailure={onFailure}
        />
      );
    content = render(resolution.composition, [...props.ancestry, key]);
  } else {
    const Renderer = resolution.Renderer as DisplayRenderer;
    const children = (node.children ?? []).map((child) => render(child));
    const slots = Object.fromEntries(
      Object.entries(node.slots ?? {}).map(([name, children]) => [
        name,
        children.map((child) => render(child)),
      ]),
    );
    content = (
      <Renderer
        node={node}
        clock={props.clock}
        mode={props.mode}
        viewport={props.viewport}
        state={props.store.get(node.id)}
        updateState={(patch) => {
          if (props.mode === "interactive") props.store.set(node.id, patch);
        }}
        slots={slots}
        resources={runtime.resourcesFor(
          resolution.manifest,
          document,
          props.inheritedResources,
        )}
        activeTargets={props.activeTargets}
        timeline={document.timeline ?? []}
      >
        {children}
      </Renderer>
    );
  }
  return (
    <DisplayNodeBoundary
      node={node}
      revision={props.revision}
      frame={props.clock.frame}
      fallback={fallback}
      onFailure={onFailure}
    >
      <Suspense
        fallback={fallback({
          reason: "loading",
          message: "Loading display component",
          nodeId: node.id,
          kind: node.kind,
        })}
      >
        {content}
      </Suspense>
    </DisplayNodeBoundary>
  );
}

/** Every leaf is isolated; one failed domain component leaves its siblings usable. */
export function DisplayRuntimeSurface({
  document,
  runtime,
  clock,
  mode = "interactive",
  viewport,
  state,
  fallback: customFallback,
  onFailure,
}: DisplayRuntimeSurfaceProps) {
  const revision = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const catalogRevision = useSyncExternalStore(
    runtime.catalog.subscribe,
    runtime.catalog.getSnapshot,
    runtime.catalog.getSnapshot,
  );
  const ownedStore = useMemo(
    () => createDisplayStateStore(),
    [document?.id, runtime],
  );
  const store = state ?? ownedStore;
  const stateRevision = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const structuralIssues = useMemo(
    () => validateDisplayDocument(document),
    [document],
  );
  const [prepared, setPrepared] = useState<{
    document: DisplayDocument;
    issues: readonly DisplayRuntimeFailure[];
  }>();
  useEffect(() => {
    let active = true;
    void runtime
      .prepare(document)
      .then((result) => {
        if (active) setPrepared({ document, issues: result.issues });
      })
      .catch((error) => {
        if (active)
          setPrepared({
            document,
            issues: [
              {
                reason: "invalid-document",
                message: "Display preparation failed",
                error,
              },
            ],
          });
      });
    return () => {
      active = false;
    };
  }, [document, runtime, catalogRevision]);
  const retry = () => {
    runtime.retry();
    void runtime
      .prepare(document)
      .then((result) => setPrepared({ document, issues: result.issues }));
  };
  const fallback = (failure: DisplayRuntimeFailure) =>
    customFallback ? (
      customFallback(failure, retry)
    ) : (
      <DisplayPlaceholder
        failure={failure}
        onRetry={mode === "interactive" ? retry : undefined}
      />
    );
  const rootIssue = structuralIssues.find((issue) => !issue.nodeId);
  if (rootIssue)
    return (
      <Failure failure={rootIssue} fallback={fallback} onFailure={onFailure} />
    );
  const ticksPerSecond = document.ticksPerSecond ?? clock.ticksPerSecond;
  const sampledClock =
    ticksPerSecond === clock.ticksPerSecond
      ? clock
      : {
          ...clock,
          ticksPerSecond,
          tick: Math.round(clock.timeSeconds * ticksPerSecond),
        };
  const failures = new Map(
    structuralIssues
      .filter((issue) => issue.nodeId)
      .map((issue) => [issue.nodeId!, issue]),
  );
  // Runtime load/resource state is live. Only structural expansion issues are frozen from preflight.
  for (const issue of prepared?.document === document ? prepared.issues : [])
    if (
      issue.nodeId &&
      ["composition-cycle", "invalid-node", "invalid-slot"].includes(
        issue.reason,
      )
    )
      failures.set(issue.nodeId, issue);
  return (
    <div
      className="xue-display-runtime"
      data-display-document={document.id}
      data-display-mode={mode}
      data-display-frame={clock.frame}
    >
      <DisplayRuntimeNode
        node={document.root}
        document={document}
        runtime={runtime}
        clock={sampledClock}
        mode={mode}
        viewport={viewport}
        store={store}
        revision={revision + stateRevision}
        failures={failures}
        inheritedResources={[]}
        depth={0}
        ancestry={[]}
        activeTargets={activeDisplayTargets(document.timeline, sampledClock)}
        fallback={fallback}
        onFailure={onFailure}
      />
    </div>
  );
}
