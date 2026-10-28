import {createElement, type ComponentType} from "react";

/** A display envelope, independent of course schemas and generation services. */
export type DisplayNode<Payload = unknown> = Readonly<{
  id: string;
  kind: string;
  version: number;
  payload: Payload;
}>;

/** Context belongs to the host: clocks, loaded data, subscriptions and actions. */
export type DisplayPluginProps<Payload = unknown, Context = unknown> = Readonly<{
  node: DisplayNode<Payload>;
  context: Context;
}>;

export type DisplayPlugin<Payload = unknown, Context = unknown> = Readonly<{
  id: string;
  kind: string;
  versions: readonly number[];
  /** Validate untrusted payloads before a component receives them. */
  validate: (payload: unknown) => payload is Payload;
  Component: ComponentType<DisplayPluginProps<Payload, Context>>;
}>;

export type DisplayFailure = Readonly<{
  reason: "invalid-node" | "unsupported" | "invalid-payload" | "validation-error" | "render-error";
  node: DisplayNode;
  pluginId?: string;
  error?: unknown;
}>;

export type DisplayResolution<Context> =
  | Readonly<{
      status: "ready";
      pluginId: string;
      /** A new registration gets a new identity, including after disposal. */
      registration: number;
      Component: ComponentType<DisplayPluginProps<unknown, Context>>;
    }>
  | Readonly<{status: "fallback"; failure: DisplayFailure}>;

type RegisteredPlugin<Context> = Readonly<{
  id: string;
  kind: string;
  versions: readonly number[];
  validate: (payload: unknown) => boolean;
  Component: ComponentType<DisplayPluginProps<unknown, Context>>;
  registration: number;
}>;

const validName = (name: string) => typeof name === "string" && name.length > 0 && name.trim() === name;
const validVersion = (version: number) => Number.isSafeInteger(version) && version > 0;

/** Create one registry per host; plugins are trusted application code. */
export class DisplayRegistry<Context = unknown> {
  private readonly plugins = new Map<string, RegisteredPlugin<Context>>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  /** Compatible with React.useSyncExternalStore, including server rendering. */
  readonly getSnapshot = (): number => this.revision;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };

  /** Reject ambiguity rather than choosing by registration order. */
  register<Payload>(plugin: DisplayPlugin<Payload, Context>): () => void {
    if (!validName(plugin.id) || !validName(plugin.kind)) throw new Error("Display plugin id and kind must be non-empty, trimmed strings");
    if (!Array.isArray(plugin.versions) || plugin.versions.length === 0 || !plugin.versions.every(validVersion) || new Set(plugin.versions).size !== plugin.versions.length) {
      throw new Error(`Display plugin ${plugin.id} needs unique positive integer versions`);
    }
    if (typeof plugin.validate !== "function" || !plugin.Component) throw new Error(`Display plugin ${plugin.id} needs a validator and component`);
    if (this.plugins.has(plugin.id)) throw new Error(`Display plugin id already registered: ${plugin.id}`);
    for (const existing of this.plugins.values()) {
      if (existing.kind === plugin.kind && existing.versions.some(version => plugin.versions.includes(version))) {
        throw new Error(`Display plugin kind/version already registered: ${plugin.kind}`);
      }
    }
    // Each registration owns a component identity, including across registries.
    // Payload validation precedes this internal type erasure in resolve().
    const Renderer = plugin.Component as ComponentType<DisplayPluginProps<unknown, Context>>;
    const RegisteredDisplayRenderer = (props: DisplayPluginProps<unknown, Context>) => createElement(Renderer, props);
    const registered: RegisteredPlugin<Context> = Object.freeze({
      id: plugin.id,
      kind: plugin.kind,
      versions: Object.freeze([...plugin.versions]),
      validate: plugin.validate,
      Component: RegisteredDisplayRenderer,
      registration: this.revision + 1,
    });
    this.plugins.set(registered.id, registered);
    this.changed();
    return () => {
      if (this.plugins.get(registered.id) !== registered) return;
      this.plugins.delete(registered.id);
      this.changed();
    };
  }

  resolve(node: DisplayNode): DisplayResolution<Context> {
    if (!node || !validName(node.id) || !validName(node.kind) || !validVersion(node.version)) {
      return {status: "fallback", failure: {reason: "invalid-node", node}};
    }
    const plugin = [...this.plugins.values()].find(candidate => candidate.kind === node.kind && candidate.versions.includes(node.version));
    if (!plugin) return {status: "fallback", failure: {reason: "unsupported", node}};
    try {
      if (!plugin.validate(node.payload)) return {status: "fallback", failure: {reason: "invalid-payload", node, pluginId: plugin.id}};
    } catch (error) {
      return {status: "fallback", failure: {reason: "validation-error", node, pluginId: plugin.id, error}};
    }
    return {status: "ready", pluginId: plugin.id, registration: plugin.registration, Component: plugin.Component};
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }
}

export const createDisplayRegistry = <Context = unknown>(): DisplayRegistry<Context> => new DisplayRegistry<Context>();
