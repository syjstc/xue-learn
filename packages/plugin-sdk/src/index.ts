/** Browser-safe contracts shared by Desktop, plugin workers and management UI. */
export const DESKTOP_PLUGIN_API_VERSION = 1 as const;

export type DesktopPluginView = { id: string; title: string } & (
  | { command: string; entry?: never; stylesheet?: never }
  | { entry: string; stylesheet?: string; command?: never }
);

/** An active, workspace-bound view. Asset URLs expire when the host closes it. */
export interface DesktopPluginViewSession {
  sessionId: string;
  moduleUrl: string;
  stylesheetUrl?: string;
  assetBaseUrl?: string;
  workspaceId: string;
}

export interface DesktopPluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  description?: string;
  runtime?: { entry: string; mode?: 'worker' | 'host' };
  /** Exact major capability versions. Optional dependencies can be added in a later schema. */
  requires: Record<string, number>;
  contributes: {
    commands: Array<{ id: string; title: string; hidden?: boolean }>;
    views?: DesktopPluginView[];
    /** Relative paths to existing display package directories; activation uses a host adapter. */
    displayPackages?: string[];
  };
  /** Every file except plugin.json is hashed; symlinks use SHA256('symlink:' + readlink target). */
  integrity: Record<string, string>;
}

export type DesktopPluginStatus = 'disabled' | 'activating' | 'active' | 'stopping' | 'failed';
export interface DesktopPluginSummary {
  manifest: DesktopPluginManifest;
  /** Opaque host session generation; changes whenever existing views are revoked. */
  viewRevision?: string;
  status: DesktopPluginStatus;
  enabled: boolean;
  installedAt: string;
  error?: string;
  missingCapabilities: string[];
}

export interface DesktopPluginExecuteInput {
  pluginId: string;
  command: string;
  args?: unknown;
  workspaceId: string;
}

export interface PluginRequest {
  type: 'request';
  requestId: string;
  method: 'activate' | 'execute' | 'dispose';
  payload?: { command?: string; args?: unknown; workspaceId?: string };
}
export interface PluginResponse {
  type: 'response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
export interface PluginCapabilityRequest {
  type: 'capability';
  requestId: string;
  /** The host-issued execute request ID binds this request to one workspace and lifetime. */
  invocationId: string;
  capability: string;
  method: string;
  args?: unknown;
}
export interface PluginCapabilityResult {
  type: 'capability-result';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
export type HostToPluginMessage = PluginRequest | PluginCapabilityResult;
export type PluginToHostMessage = PluginResponse | PluginCapabilityRequest;

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPluginIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && IDENTIFIER.test(value) && !FORBIDDEN_KEYS.has(value);
}

export function isPluginRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && !/[\\:\u0000-\u001f]/.test(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}: expected an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, maximum = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}
function identifier(value: unknown, label: string): string {
  if (!isPluginIdentifier(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function relativePath(value: unknown, label: string): string {
  if (!isPluginRelativePath(value)) throw new Error(`Invalid ${label}: expected a package-relative path`);
  return value;
}

/** Validate and copy untrusted JSON, never exposing its prototypes to host registries. */
export function parseDesktopPluginManifest(input: unknown): DesktopPluginManifest {
  const raw = object(input, 'plugin manifest');
  if (raw.schemaVersion !== 1) throw new Error('Unsupported plugin manifest schemaVersion');
  if (raw.apiVersion !== DESKTOP_PLUGIN_API_VERSION) throw new Error('Unsupported plugin apiVersion');
  const version = string(raw.version, 'plugin version', 100);
  if (!VERSION.test(version)) throw new Error('Invalid plugin version: expected semantic version');
  const requires: Record<string, number> = {};
  for (const [name, major] of Object.entries(object(raw.requires ?? {}, 'requires'))) {
    identifier(name, 'capability name');
    if (!Number.isSafeInteger(major) || Number(major) < 1) throw new Error(`Invalid capability version: ${name}`);
    requires[name] = major as number;
  }
  const contribution = object(raw.contributes ?? {}, 'contributes');
  if (contribution.commands !== undefined && !Array.isArray(contribution.commands)) throw new Error('Invalid contributes.commands');
  const commands = ((contribution.commands ?? []) as unknown[]).map(value => {
    const command = object(value, 'command');
    if(command.hidden !== undefined && typeof command.hidden !== 'boolean')throw new Error('Invalid command hidden flag');
    return { id: identifier(command.id, 'command id'), title: string(command.title, 'command title', 200), ...(command.hidden !== undefined ? {hidden:command.hidden as boolean} : {}) };
  });
  if (new Set(commands.map(command => command.id)).size !== commands.length) throw new Error('Duplicate plugin command id');
  if (contribution.views !== undefined && !Array.isArray(contribution.views)) throw new Error('Invalid contributes.views');
  const views = (contribution.views as unknown[] | undefined)?.map((value): DesktopPluginView => {
    const view = object(value, 'view');
    const identity = { id: identifier(view.id, 'view id'), title: string(view.title, 'view title', 200) };
    if (view.entry !== undefined) {
      if (view.command !== undefined) throw new Error('A view must declare either an entry or a command');
      const entry = relativePath(view.entry, 'view entry');
      if (!/\.(?:mjs|js)$/.test(entry)) throw new Error('View entry must be an ES module');
      const stylesheet = view.stylesheet === undefined ? undefined : relativePath(view.stylesheet, 'view stylesheet');
      if (stylesheet && !stylesheet.endsWith('.css')) throw new Error('View stylesheet must be CSS');
      return { ...identity, entry, ...(stylesheet ? { stylesheet } : {}) };
    }
    if (view.stylesheet !== undefined) throw new Error('View stylesheet requires an embedded entry');
    const command = identifier(view.command, 'view command');
    if (!commands.some(item => item.id === command)) throw new Error(`View references undeclared command: ${command}`);
    return { ...identity, command };
  });
  if (views && new Set(views.map(view => view.id)).size !== views.length) throw new Error('Duplicate plugin view id');
  if (contribution.displayPackages !== undefined && !Array.isArray(contribution.displayPackages)) throw new Error('Invalid contributes.displayPackages');
  const displayPackages = (contribution.displayPackages as unknown[] | undefined)?.map(value => relativePath(value, 'display package'));
  if (displayPackages && new Set(displayPackages).size !== displayPackages.length) throw new Error('Duplicate display package');
  const integrity: Record<string, string> = {};
  for (const [path, digest] of Object.entries(object(raw.integrity, 'integrity'))) {
    relativePath(path, 'integrity file');
    if (path === 'plugin.json' || !/^[a-f0-9]{64}$/.test(String(digest))) throw new Error(`Invalid integrity entry: ${path}`);
    integrity[path] = String(digest);
  }
  for (const view of views ?? []) {
    if (view.entry && !Object.hasOwn(integrity, view.entry)) throw new Error('View entry is missing from integrity');
    if (view.stylesheet && !Object.hasOwn(integrity, view.stylesheet)) throw new Error('View stylesheet is missing from integrity');
  }
  let runtime: DesktopPluginManifest['runtime'];
  if (raw.runtime !== undefined) {
    const entry = relativePath(object(raw.runtime, 'runtime').entry, 'runtime entry');
    if (!/\.(?:cjs|mjs|js)$/.test(entry)) throw new Error('Runtime entry must be a JavaScript module');
    if (!Object.hasOwn(integrity, entry)) throw new Error('Runtime entry is missing from integrity');
    const mode = object(raw.runtime, 'runtime').mode;
    if (mode !== undefined && mode !== 'worker' && mode !== 'host') throw new Error('Unsupported plugin runtime mode');
    runtime = { entry, ...(mode === undefined ? {} : { mode }) };
  } else if (commands.length) {
    throw new Error('Command contributions require a runtime');
  }
  return {
    schemaVersion: 1, id: identifier(raw.id, 'plugin id'), name: string(raw.name, 'plugin name', 200),
    version, apiVersion: 1,
    ...(raw.description === undefined ? {} : { description: string(raw.description, 'plugin description', 4000) }),
    ...(runtime ? { runtime } : {}), requires,
    contributes: { commands, ...(views ? { views } : {}), ...(displayPackages ? { displayPackages } : {}) }, integrity,
  };
}

export function missingPluginCapabilities(manifest: DesktopPluginManifest, available: Readonly<Record<string, number>>): string[] {
  return Object.entries(manifest.requires)
    .filter(([name, version]) => !Object.hasOwn(available, name) || available[name] !== version)
    .map(([name, version]) => `${name}@${version}`);
}
