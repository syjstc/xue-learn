/** Portable display documents. Package versions and component schema versions are distinct. */
export type DisplayNode<Payload = unknown> = Readonly<{
  id: string;
  kind: string;
  version: number;
  payload: Payload;
  children?: readonly DisplayNode[];
  slots?: Readonly<Record<string, readonly DisplayNode[]>>;
  /** Local target names; their public identity is `${node.id}/${target}`. */
  targets?: readonly string[];
  build?: Readonly<{jobId: string; status: "pending" | "running" | "ready" | "failed" | "cancelled"; sourceHash?: string; revision?: number; error?: string}>;
}>;

export type DisplayPluginLock = Readonly<{id: string; version: string; integrity?: string}>;
export type DisplayResource = Readonly<{id: string; kind: "image" | "audio" | "video" | "font" | "data"; uri: string; integrity?: string; required?: boolean}>;
export type DisplayTimelineCue = Readonly<{id: string; startTick: number; durationTicks: number; targets: readonly string[]}>;
export type DisplayDocument = Readonly<{
  version: 1;
  id: string;
  root: DisplayNode;
  plugins: readonly DisplayPluginLock[];
  resources?: readonly DisplayResource[];
  timeline?: readonly DisplayTimelineCue[];
  ticksPerSecond?: number;
  durationTicks?: number;
  seed?: number;
}>;

export type DisplayJsonSchema = Readonly<Record<string, unknown>> | boolean;
export type DisplaySlotDefinition = Readonly<{description?: string; required?: boolean; multiple?: boolean; accepts?: readonly string[]}>;
export type DisplayBuilderDescriptor = Readonly<{id: string; description: string; inputSchema?: DisplayJsonSchema; outputKind: string; outputVersion: number}>;
export type DisplayComponentManifest = Readonly<{
  kind: string;
  version: number;
  description?: string;
  payloadSchema?: DisplayJsonSchema;
  examples?: readonly unknown[];
  slots?: Readonly<Record<string, DisplaySlotDefinition>>;
  targets?: readonly string[];
  cues?: readonly Readonly<{name: string; description?: string}>[];
  /** Trusted renderers may request named package/document resources before painting. */
  resources?: readonly string[];
  /** Declarative components never execute package JavaScript. */
  composition?: DisplayNode;
}>;
export type DisplayPluginManifest = Readonly<{
  apiVersion: 1;
  id: string;
  version: string;
  integrity?: string;
  title?: string;
  description?: string;
  domains?: readonly string[];
  execution: "trusted" | "declarative";
  components: readonly DisplayComponentManifest[];
  dependencies?: readonly DisplayPluginLock[];
  resources?: readonly DisplayResource[];
  builders?: readonly DisplayBuilderDescriptor[];
}>;

/** The host resolves trusted code. A manifest URL is never executed by this library. */
export type DisplayPluginModule<Renderer = unknown> = Readonly<{
  components: Readonly<Record<string, Renderer>>;
  validators?: Readonly<Record<string, (payload: unknown) => boolean>>;
}>;
export type DisplayFailureReason = "loading" | "building" | "build-failed" | "missing-plugin" | "version-mismatch" | "invalid-document" | "invalid-node" | "invalid-payload" | "invalid-slot" | "dependency-cycle" | "composition-cycle" | "load-error" | "resource-error" | "render-error";
export type DisplayRuntimeFailure = Readonly<{reason: DisplayFailureReason; message: string; nodeId?: string; kind?: string; pluginId?: string; resourceId?: string; error?: unknown}>;
export type DisplayClock = Readonly<{frame: number; fps: number; tick: number; ticksPerSecond: number; timeSeconds: number; playing: boolean}>;
export type DisplayResourceState = Readonly<{status: "loading" | "ready" | "failed"; value?: unknown; error?: unknown}>;
export type DisplayRuntimeResolution<Renderer = unknown> =
  | Readonly<{status: "ready"; manifest: DisplayPluginManifest; component: DisplayComponentManifest; Renderer?: Renderer; composition?: DisplayNode}>
  | Readonly<{status: "unavailable"; failure: DisplayRuntimeFailure}>;
