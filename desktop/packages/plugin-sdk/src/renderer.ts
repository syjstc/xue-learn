import type * as React from 'react';
import type { CourseSourceSnapshotV1 } from '@xue-learn/core/runtime-contracts';
import { DESKTOP_PLUGIN_UI_SLOTS, isDesktopPluginLocalPath, type DesktopPluginUiContext, type DesktopPluginUiSlot } from './index.js';

/** Published course catalog fields supplied by the selected Desktop workspace. */
export interface DesktopPluginCourse {
  workspaceId: string;
  unitId: string;
  title: string;
  goalId: string;
  goalTitle: string;
  moduleId: string | null;
  moduleTitle: string | null;
  spaceId: string | null;
  spaceName: string | null;
  orderIndex: number;
  [field: string]: unknown;
}

export interface DesktopPluginUi {
  Button: React.ComponentType<React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';
    size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg';
  }>;
  Card: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  CardHeader: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  CardTitle: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  CardDescription: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  CardContent: React.ComponentType<React.HTMLAttributes<HTMLDivElement>>;
  Input: React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>;
  Badge: React.ComponentType<React.HTMLAttributes<HTMLSpanElement> & {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link';
  }>;
}

/** The host supplies React, shared components and workspace-bound service calls. */
export interface DesktopPluginRendererHost {
  readonly version: 1;
  readonly React: typeof React;
  readonly ReactDOM: typeof import('react-dom');
  readonly ReactDOMServer: Pick<typeof import('react-dom/server'), 'renderToStaticMarkup'>;
  assetUrl(path: string): string;
  readonly pluginId: string;
  readonly viewId: string;
  readonly workspaceId: string;
  /** Initial route inside the plugin's private router, resolved from its declared UI contribution. */
  readonly initialPath: string;
  readonly context: Readonly<DesktopPluginUiContext>;
  readonly ui: DesktopPluginUi;
  readonly signal: AbortSignal;
  readonly core: {
    readonly courseSource: {
      catalog(): Promise<DesktopPluginCourse[]>;
      readUnit(unitId: string): Promise<CourseSourceSnapshotV1 | null>;
    };
    readonly display: {
      TeachingDisplay: typeof import('@xue-learn/core/display')['TeachingDisplay'];
      InlineMathText: typeof import('@xue-learn/core/display')['InlineMathText'];
    };
  };
  /** Only capabilities declared by the plugin may be called. */
  call<T = unknown>(capability: string, method: string, args?: unknown): Promise<T>;
  /** Optional background commands; uses the same workspace as this view. */
  execute<T = unknown>(command: string, args?: unknown): Promise<T>;
  navigate(path: string): void;
  /** Register reversible module-level work. React component effects also clean up normally. */
  onDispose(callback: () => void): () => void;
}

/** Bundle an ES module with React supplied through host.React, never another React instance. */
export interface DesktopPluginRendererModule {
  createView(host: DesktopPluginRendererHost): React.ComponentType;
}

export interface DesktopPluginViewLaunch {
  initialPath?: string;
  context?: DesktopPluginUiContext;
}

export function desktopPluginViewPath(pluginId: string, viewId: string, launch?: DesktopPluginViewLaunch): string {
  const path = `/local/plugins/${encodeURIComponent(pluginId)}/views/${encodeURIComponent(viewId)}`;
  if (!launch) return path;
  const query = new URLSearchParams();
  if (launch.initialPath && isDesktopPluginLocalPath(launch.initialPath)) query.set('pluginPath', launch.initialPath);
  for (const [field, value] of Object.entries(launch.context ?? {})) {
    if (value) query.set(field, value);
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/** Deep links are presentation input; discard malformed paths and unknown context fields. */
export function desktopPluginViewLaunch(search: string): DesktopPluginViewLaunch {
  const query = new URLSearchParams(search);
  const context: DesktopPluginUiContext = {};
  const slot = query.get('slot');
  if (DESKTOP_PLUGIN_UI_SLOTS.includes(slot as DesktopPluginUiSlot)) context.slot = slot as DesktopPluginUiSlot;
  for (const field of ['goalId', 'unitId', 'sectionId'] as const) {
    const value = query.get(field);
    if (value && value.length <= 200 && !/[\\/\u0000-\u0020\u007f]/.test(value) && value !== '.' && value !== '..') context[field] = value;
  }
  const returnTo = query.get('returnTo');
  if (isDesktopPluginLocalPath(returnTo)) context.returnTo = returnTo;
  const path = query.get('pluginPath');
  return { initialPath: isDesktopPluginLocalPath(path) ? path : '/', context };
}

export function desktopPluginSettingsTabId(pluginId: string, contributionId: string): string {
  return `plugin:${pluginId}:${contributionId}`;
}

export function desktopPluginSettingsPath(pluginId: string, contributionId: string): string {
  return `/settings?${new URLSearchParams({ tab: desktopPluginSettingsTabId(pluginId, contributionId) })}`;
}
