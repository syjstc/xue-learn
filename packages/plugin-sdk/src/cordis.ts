import type {} from 'cordis';
import type { DesktopPluginManifest } from './index';

export interface DesktopPluginInvocation {
  readonly workspaceId: string;
  /** Scoped to this command and its original workspace; unusable after it returns. */
  call(capability: string, method: string, args?: unknown): Promise<unknown>;
}
export interface DesktopPluginConfiguration {
  readonly pluginRoot: string;
  readonly storagePath: string;
  readonly manifest: DesktopPluginManifest;
}
export type DesktopPluginCommand = (args: unknown, invocation: DesktopPluginInvocation) => unknown | Promise<unknown>;
export interface DesktopPluginService {
  /** Available only to trusted runtime.mode=host modules, never renderer IPC. */
  readonly native?: DesktopPluginNativeServices;
  /** Use ctx.effect(() => ctx.desktop.registerCommand(...)) for reversible registration. */
  registerCommand(id: string, handler: DesktopPluginCommand): () => void;
  /** Check outstanding work BEFORE Cordis begins irreversible resource teardown. */
  beforeDeactivate(check: () => void | Promise<void>): () => void;
}

export interface DesktopPluginSurfaceRequest {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}
export interface DesktopPluginSurfaceResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}
export interface DesktopPluginNativeServices {
  bindWorkspace(workspaceId: string): Promise<{
    workspaceId: string;
    ownerId: string;
    signal: AbortSignal;
    call<T = unknown>(capability: string, method: string, args?: unknown): Promise<T>;
  }>;
  createSurface(options: {
    workspaceId: string;
    /** Package-relative static renderer directory. Files must have integrity hashes. */
    root: string;
    request(request: DesktopPluginSurfaceRequest): Promise<DesktopPluginSurfaceResponse>;
  }): { baseUrl: string; dispose(): void };
  /** Main-process provider composition only; never return these values from a command. */
  getAIEnvironment(): Promise<Record<string, string>>;
  codexToken(request?: { forceRefresh?: boolean }): Promise<string>;
}
declare module 'cordis' {
  interface Context { desktop: DesktopPluginService }
}
/** Stable structural view of the real Cordis context, independent of upstream type packaging. */
export interface DesktopPluginContext {
  desktop: DesktopPluginService;
  effect(callback: () => (() => unknown) | Promise<() => unknown>): () => Promise<void>;
  inject(services: string[], callback: (context: DesktopPluginContext) => void | Promise<void>): PromiseLike<unknown>;
  provide(name: string, service: unknown): void;
  plugin(plugin: DesktopCordisPlugin, configuration?: DesktopPluginConfiguration): PromiseLike<unknown>;
}
export interface DesktopCordisPlugin {
  name?: string;
  inject?: string[];
  apply(context: DesktopPluginContext, configuration: DesktopPluginConfiguration): void | Promise<void>;
}
