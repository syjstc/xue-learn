import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  DesktopPluginManifest, DesktopPluginSummary, HostToPluginMessage, missingPluginCapabilities,
  PluginCapabilityRequest, PluginRequest, PluginResponse,
} from '../../../../packages/plugin-sdk/src';
import { DesktopPluginPackageStore, InstalledDesktopPlugin } from './package-store';

export interface DesktopPluginProcess {
  send(message: HostToPluginMessage): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onExit(listener: (code: number | null) => void): () => void;
  kill(): void | Promise<void>;
}
export interface DesktopPluginProcessConfiguration {
  pluginId: string;
  pluginRoot: string;
  entry: string;
  storagePath: string;
  manifest: DesktopPluginManifest;
}
export interface DesktopPluginCapabilityContext {
  pluginId: string;
  workspaceId: string;
  signal: AbortSignal;
}
export interface DesktopPluginCapabilityHost {
  versions: Readonly<Record<string, number>>;
  invoke(capability: string, method: string, args: unknown, context: DesktopPluginCapabilityContext): Promise<unknown>;
}
export interface DesktopPluginManagerOptions {
  store: DesktopPluginPackageStore;
  processFactory(config: DesktopPluginProcessConfiguration): DesktopPluginProcess | Promise<DesktopPluginProcess>;
  capabilities: DesktopPluginCapabilityHost;
  /** The adapter owns existing display packages and returns a complete contribution disposer. */
  registerContributions?(plugin: InstalledDesktopPlugin): Promise<() => void | Promise<void>>;
  activationTimeoutMs?: number;
  commandTimeoutMs?: number;
  disposeTimeoutMs?: number;
  onChange?(): void;
}
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
interface Invocation { workspaceId: string; controller: AbortController }
interface Runtime {
  installed: InstalledDesktopPlugin;
  viewRevision: string;
  status: DesktopPluginSummary['status'];
  process?: DesktopPluginProcess;
  pending: Map<string, Pending>;
  invocations: Map<string, Invocation>;
  listeners: Array<() => void>;
  disposeContributions?: () => void | Promise<void>;
  error?: string;
  stopping?: boolean;
}
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Owns package/process boundaries. Cordis inside each worker owns plugin contexts and effects. */
export class DesktopPluginManager {
  private readonly runtimes = new Map<string, Runtime>();
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: DesktopPluginManagerOptions) {}

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(action, action);
    this.mutation = next.catch(() => undefined);
    return next;
  }
  private changed(): void { try { this.options.onChange?.(); } catch { /* UI observers do not own runtime health. */ } }
  private summary(installed: InstalledDesktopPlugin): DesktopPluginSummary {
    const runtime = this.runtimes.get(installed.manifest.id);
    return {
      manifest: installed.manifest, installedAt: installed.installedAt, enabled: installed.enabled,
      status: runtime?.status ?? 'disabled', ...(runtime?.error ? { error: runtime.error } : {}),
      ...(runtime ? { viewRevision: runtime.viewRevision } : {}),
      missingCapabilities: missingPluginCapabilities(installed.manifest, this.options.capabilities.versions),
    };
  }
  async list(): Promise<DesktopPluginSummary[]> { return (await this.options.store.list()).map(plugin => this.summary(plugin)); }
  /** Host-only access used by the embedded view loader; never sent to the renderer. */
  activePlugin(id: string): InstalledDesktopPlugin {
    const runtime = this.runtimes.get(id);
    if (!runtime || runtime.status !== 'active') throw new Error(`Plugin is not active: ${id}`);
    return runtime.installed;
  }
  async callCapability(id: string, capability: string, method: string, args: unknown, context: Omit<DesktopPluginCapabilityContext, 'pluginId'>): Promise<unknown> {
    const installed = this.activePlugin(id);
    context.signal.throwIfAborted();
    if (!Object.hasOwn(installed.manifest.requires, capability)) throw new Error('Plugin did not declare this capability');
    if (!/^[a-zA-Z][a-zA-Z0-9.-]{0,100}$/.test(method)) throw new Error('Invalid capability method');
    if (this.options.capabilities.versions[capability] !== installed.manifest.requires[capability]) throw new Error('Host capability is no longer available');
    const result = await this.options.capabilities.invoke(capability, method, args, { ...context, pluginId: id });
    context.signal.throwIfAborted();
    if (this.activePlugin(id) !== installed) throw new Error('Plugin activation has changed');
    return result;
  }
  /** One broken extension must not prevent unrelated enabled extensions from starting. */
  async restoreEnabled(): Promise<DesktopPluginSummary[]> {
    for (const plugin of await this.options.store.list()) {
      if (plugin.enabled) {
        try { await this.enable(plugin.manifest.id); } catch { /* Failure is retained in this plugin's status. */ }
      }
    }
    return this.list();
  }
  install(directory: string): Promise<DesktopPluginSummary> {
    return this.serialize(async () => {
      const installed = await this.options.store.install(directory);
      this.runtimes.delete(installed.manifest.id);
      this.changed();
      return this.summary(installed);
    });
  }
  enable(id: string): Promise<DesktopPluginSummary> { return this.serialize(() => this.activate(id)); }
  private async activate(id: string): Promise<DesktopPluginSummary> {
    const existing = this.runtimes.get(id);
    if (existing?.status === 'active') return this.summary(await this.options.store.get(id));
    // Never replace a runtime whose termination previously failed.
    if (existing?.process) await this.cleanup(existing);
    const installed = await this.options.store.get(id);
    const runtime: Runtime = { installed, viewRevision: randomUUID(), status: 'activating', pending: new Map(), invocations: new Map(), listeners: [] };
    this.runtimes.set(id, runtime);
    this.changed();
    try {
      await this.options.store.verify(id);
      const missing = missingPluginCapabilities(installed.manifest, this.options.capabilities.versions);
      if (missing.length) throw new Error(`Missing host capabilities: ${missing.join(', ')}`);
      if ((installed.manifest.contributes.displayPackages?.length ?? 0) > 0 && !this.options.registerContributions) {
        throw new Error('The host does not provide a display package adapter');
      }
      if (installed.manifest.runtime) {
        runtime.process = await this.options.processFactory({
          pluginId: id, pluginRoot: installed.root, entry: path.join(installed.root, installed.manifest.runtime.entry),
          storagePath: await this.options.store.storagePath(id), manifest: installed.manifest,
        });
        runtime.listeners.push(runtime.process.onMessage(message => { void this.message(runtime, message); }));
        runtime.listeners.push(runtime.process.onExit(code => {
          if (!runtime.stopping) void this.fail(runtime, new Error(`Plugin process exited (${code ?? 'unknown'})`));
        }));
        await this.request(runtime, 'activate', undefined, this.options.activationTimeoutMs ?? 15_000);
      }
      if (this.options.registerContributions) runtime.disposeContributions = await this.options.registerContributions(installed);
      if (runtime.status === 'failed') throw new Error(runtime.error ?? 'Plugin process failed during activation');
      await this.options.store.setEnabled(id, true);
      // The process can exit while the enabled preference is being persisted.
      // Never overwrite its failure notification with a stale activation success.
      if ((runtime.status as DesktopPluginSummary['status']) === 'failed'
        || (installed.manifest.runtime && !runtime.process)) {
        throw new Error(runtime.error ?? 'Plugin process exited during activation');
      }
      runtime.installed.enabled = true;
      runtime.status = 'active';
      this.changed();
      return this.summary(runtime.installed);
    } catch (error) {
      await this.fail(runtime, error);
      throw error;
    }
  }
  disable(id: string): Promise<DesktopPluginSummary> { return this.serialize(() => this.deactivate(id)); }
  private async deactivate(id: string): Promise<DesktopPluginSummary> {
    const installed = await this.options.store.get(id);
    const runtime = this.runtimes.get(id);
    if (runtime && runtime.status === 'active') {
      if (runtime.invocations.size) throw new Error('Plugin has running commands; wait for them to finish before disabling it');
      runtime.status = 'stopping';
      // View sessions are revoked on stopping, even if a worker guard subsequently
      // refuses. The renderer must observe that change after coalesced events.
      runtime.viewRevision = randomUUID();
      runtime.error = undefined;
      this.changed();
      try {
        if (runtime.process) await this.request(runtime, 'dispose', undefined, this.options.disposeTimeoutMs ?? 15_000);
      } catch (error) {
        // A worker's beforeDeactivate guard may refuse while an export is running.
        // Keep it alive and installed: failed shutdown must never kill active user work.
        if ((runtime.status as DesktopPluginSummary['status']) !== 'failed') runtime.status = 'active';
        runtime.error = errorMessage(error);
        this.changed();
        throw error;
      }
    }
    if (runtime) {
      await this.cleanup(runtime);
      runtime.status = 'disabled';
      runtime.error = undefined;
    }
    await this.options.store.setEnabled(id, false);
    installed.enabled = false;
    if (runtime) runtime.installed.enabled = false;
    this.changed();
    return this.summary(installed);
  }
  remove(id: string): Promise<void> {
    return this.serialize(async () => {
      await this.deactivate(id);
      await this.options.store.remove(id);
      this.runtimes.delete(id);
      this.changed();
    });
  }

  async execute(id: string, command: string, args: unknown, workspaceId: string): Promise<unknown> {
    if (typeof workspaceId !== 'string' || !workspaceId.trim() || workspaceId.length > 200) throw new Error('A valid workspace is required');
    const runtime = this.runtimes.get(id);
    if (!runtime || runtime.status !== 'active' || !runtime.process) throw new Error(`Plugin is not active: ${id}`);
    if (!runtime.installed.manifest.contributes.commands.some(item => item.id === command)) throw new Error(`Undeclared plugin command: ${command}`);
    const requestId = randomUUID();
    const invocation: Invocation = { workspaceId, controller: new AbortController() };
    runtime.invocations.set(requestId, invocation);
    try {
      return await this.request(runtime, 'execute', { command, args, workspaceId }, this.options.commandTimeoutMs ?? 120_000, requestId);
    } finally {
      runtime.invocations.delete(requestId);
      invocation.controller.abort();
    }
  }

  /** Busy workers reject shutdown and remain alive. The application decides whether to defer quit. */
  shutdown(): Promise<void> {
    return this.serialize(async () => {
      const failures: string[] = [];
      for (const id of this.runtimes.keys()) {
        try {
          // Preserve enabled preference for the next application launch.
          const enabled = (await this.options.store.get(id)).enabled;
          await this.deactivate(id);
          if (enabled) await this.options.store.setEnabled(id, true);
        } catch (error) { failures.push(`${id}: ${errorMessage(error)}`); }
      }
      if (failures.length) throw new Error(`Plugins could not stop: ${failures.join('; ')}`);
    });
  }

  private request(runtime: Runtime, method: PluginRequest['method'], payload: PluginRequest['payload'], timeoutMs: number, requestId = randomUUID()): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        runtime.pending.delete(requestId);
        const error = new Error(`Plugin ${method} timed out after ${timeoutMs}ms`);
        reject(error);
        // Disposing may be waiting for active external work; only activation and command failure kill.
        if (method !== 'dispose') void this.fail(runtime, error);
      }, timeoutMs);
      runtime.pending.set(requestId, { resolve, reject, timer });
      try {
        if (!runtime.process) throw new Error('Plugin process is unavailable');
        runtime.process.send({ type: 'request', requestId, method, ...(payload ? { payload } : {}) });
      } catch (error) {
        clearTimeout(timer);
        runtime.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async message(runtime: Runtime, raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as { type?: string; requestId?: string };
    if (typeof message.requestId !== 'string' || message.requestId.length > 200) return;
    if (message.type === 'response') {
      const response = raw as PluginResponse;
      const pending = runtime.pending.get(response.requestId);
      if (!pending) return;
      runtime.pending.delete(response.requestId);
      clearTimeout(pending.timer);
      if (response.ok === true) pending.resolve(response.result);
      else pending.reject(new Error(typeof response.error === 'string' ? response.error : 'Plugin request failed'));
      return;
    }
    if (message.type !== 'capability') return;
    const request = raw as PluginCapabilityRequest;
    try {
      const invocation = runtime.invocations.get(request.invocationId);
      if (runtime.status !== 'active' || !invocation || invocation.controller.signal.aborted) throw new Error('Capability call is outside a live workspace invocation');
      if (typeof request.capability !== 'string' || !Object.hasOwn(runtime.installed.manifest.requires, request.capability)) throw new Error('Plugin did not declare this capability');
      if (typeof request.method !== 'string' || !/^[a-zA-Z][a-zA-Z0-9.-]{0,100}$/.test(request.method)) throw new Error('Invalid capability method');
      if (this.options.capabilities.versions[request.capability] !== runtime.installed.manifest.requires[request.capability]) throw new Error('Host capability is no longer available');
      const result = await this.options.capabilities.invoke(request.capability, request.method, request.args, {
        pluginId: runtime.installed.manifest.id, workspaceId: invocation.workspaceId, signal: invocation.controller.signal,
      });
      if (!invocation.controller.signal.aborted && runtime.status === 'active') runtime.process?.send({ type: 'capability-result', requestId: request.requestId, ok: true, result });
    } catch (error) {
      try { runtime.process?.send({ type: 'capability-result', requestId: request.requestId, ok: false, error: errorMessage(error) }); } catch { /* Worker already exited. */ }
    }
  }

  private async fail(runtime: Runtime, error: unknown): Promise<void> {
    runtime.status = 'failed';
    runtime.error = errorMessage(error);
    this.changed();
    try { await this.cleanup(runtime); } catch { /* Retain the handle and failed status for an explicit retry. */ }
  }
  private async cleanup(runtime: Runtime): Promise<void> {
    runtime.stopping = true;
    for (const pending of runtime.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(runtime.error ?? 'Plugin stopped'));
    }
    runtime.pending.clear();
    for (const invocation of runtime.invocations.values()) invocation.controller.abort();
    runtime.invocations.clear();
    const process = runtime.process;
    try { await process?.kill(); }
    catch (error) {
      runtime.status = 'failed';
      runtime.error = `Plugin process could not stop: ${errorMessage(error)}`;
      this.changed();
      throw error;
    }
    runtime.process = undefined;
    for (const dispose of runtime.listeners.splice(0)) dispose();
    const disposeContributions = runtime.disposeContributions;
    runtime.disposeContributions = undefined;
    await disposeContributions?.();
  }
}
