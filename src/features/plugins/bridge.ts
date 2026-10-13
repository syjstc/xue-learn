import type { DesktopPluginSummary, DesktopPluginViewSession } from "../../../packages/plugin-sdk/src/index";

/** This bridge is owned by Desktop and versioned separately from Core. */
export interface DesktopPluginsBridge {
  list(): Promise<DesktopPluginSummary[]>;
  install(): Promise<DesktopPluginSummary[] | null>;
  enable(id: string): Promise<DesktopPluginSummary[]>;
  disable(id: string): Promise<DesktopPluginSummary[]>;
  remove(id: string): Promise<DesktopPluginSummary[]>;
  execute(id: string, command: string, args?: unknown): Promise<unknown>;
  openView(id: string, viewId: string): Promise<DesktopPluginViewSession>;
  callView(sessionId: string, capability: string, method: string, args?: unknown): Promise<unknown>;
  executeView(sessionId: string, command: string, args?: unknown): Promise<unknown>;
  closeView(sessionId: string): Promise<void>;
  onChanged?(listener: () => void): () => void;
}

declare global {
  interface Window {
    xueLearnPlugins?: DesktopPluginsBridge;
  }
}

export function getDesktopPluginsBridge(): DesktopPluginsBridge | undefined {
  return typeof window === "undefined" ? undefined : window.xueLearnPlugins;
}
