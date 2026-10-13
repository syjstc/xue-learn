import React, {Component, Suspense, useEffect, useMemo, useSyncExternalStore, type ReactNode} from "react";
import {type DisplayFailure, type DisplayNode, type DisplayRegistry} from "./display-registry.js";

export type DisplaySurfaceProps<Context = unknown> = Readonly<{
  registry: DisplayRegistry<Context>;
  node: DisplayNode;
  context: Context;
  fallback?: (failure: DisplayFailure) => ReactNode;
  loadingFallback?: ReactNode;
  onFailure?: (failure: DisplayFailure) => void;
}>;

const defaultFallback = (failure: DisplayFailure): ReactNode => <div role="status" data-display-fallback={failure.reason}>This content is unavailable.</div>;

type BoundaryProps = Readonly<{
  node: DisplayNode;
  pluginId: string;
  resetKeys: readonly unknown[];
  fallback: (failure: DisplayFailure) => ReactNode;
  onFailure?: (failure: DisplayFailure) => void;
  children: ReactNode;
}>;

class DisplayErrorBoundary extends Component<BoundaryProps, {failed: boolean; error?: unknown}> {
  state: {failed: boolean; error?: unknown} = {failed: false};

  static getDerivedStateFromError(error: unknown) {return {failed: true, error};}

  componentDidCatch(error: unknown) {
    this.props.onFailure?.({reason: "render-error", node: this.props.node, pluginId: this.props.pluginId, error});
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (this.state.failed && previous.resetKeys.some((value, index) => !Object.is(value, this.props.resetKeys[index]))) {
      this.setState({failed: false, error: undefined});
    }
  }

  render() {
    if (this.state.failed) return this.props.fallback({reason: "render-error", node: this.props.node, pluginId: this.props.pluginId, error: this.state.error});
    return this.props.children;
  }
}

/** Host-driven renderer. No fetch, generator, clock or global registry is owned here. */
export function DisplaySurface<Context = unknown>({registry, node, context, fallback = defaultFallback, loadingFallback = null, onFailure}: DisplaySurfaceProps<Context>) {
  const revision = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  const resolution = useMemo(() => registry.resolve(node), [registry, revision, node]);
  useEffect(() => {
    if (resolution.status === "fallback") onFailure?.(resolution.failure);
  }, [resolution, onFailure]);

  if (resolution.status === "fallback") return <>{fallback(resolution.failure)}</>;
  const Renderer = resolution.Component;
  const identity = JSON.stringify([node.id, node.kind, node.version, resolution.pluginId, resolution.registration]);
  return <DisplayErrorBoundary key={identity} node={node} pluginId={resolution.pluginId} resetKeys={[node, context, registry, revision]} fallback={fallback} onFailure={onFailure}>
    <Suspense fallback={loadingFallback}>
      <Renderer node={node} context={context}/>
    </Suspense>
  </DisplayErrorBoundary>;
}
