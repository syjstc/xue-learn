import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, sep, posix } from 'node:path';
import { verifiedPluginAsset } from './package-assets';
import type { DesktopPluginViewSession } from '../../../../packages/plugin-sdk/src/index';
import type { DesktopPluginManager } from './manager';

export const PLUGIN_VIEW_SCHEME = 'xuelearn-plugin';
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
interface ViewSession {
  pluginId: string;
  workspaceId: string;
  activation: ReturnType<DesktopPluginManager['activePlugin']>;
  controller: AbortController;
  directory: string;
  assets: Map<string, { body: Buffer; contentType: string }>;
}

/** UI sessions belong to one host-selected workspace and one plugin activation. */
export class DesktopPluginViews {
  private readonly sessions = new Map<string, ViewSession>();
  private generation = 0;
  get revision(): number { return this.generation; }
  constructor(private readonly manager: DesktopPluginManager, private readonly getWorkspaceId: () => string) {}

  async open(pluginId: string, viewId: string): Promise<DesktopPluginViewSession> {
    this.reconcile();
    if (this.sessions.size >= 32) throw new Error('Too many open plugin views');
    const activation = this.manager.activePlugin(pluginId);
    const view = activation.manifest.contributes.views?.find(item => item.id === viewId);
    if (!view || !view.entry) throw new Error('Plugin does not declare this embedded view');
    const workspaceId = this.getWorkspaceId();
    if (!workspaceId) throw new Error('A workspace is required');
    const assets: ViewSession['assets'] = new Map();
    const readAsset = async (file: string): Promise<Buffer> => {
      const location = join(activation.root, file);
      const actual = await realpath(location);
      const root = await realpath(activation.root);
      const rel = relative(root, actual);
      if (rel === '..' || rel.startsWith(`..${sep}`) || !rel) throw new Error('Plugin view asset escapes its package');
      const info = await lstat(location);
      if (!info.isFile() || info.size > MAX_ASSET_BYTES) throw new Error('Plugin view asset must be a regular file of at most 16 MiB');
      const bytes = await readFile(location);
      if (bytes.length > MAX_ASSET_BYTES || createHash('sha256').update(bytes).digest('hex') !== activation.manifest.integrity[file]) {
        throw new Error(`Plugin view integrity mismatch: ${file}`);
      }
      return bytes;
    };
    assets.set('module.mjs', { body: await readAsset(view.entry), contentType: 'text/javascript; charset=utf-8' });
    if (view.stylesheet) assets.set('style.css', { body: await readAsset(view.stylesheet), contentType: 'text/css; charset=utf-8' });
    if (this.manager.activePlugin(pluginId) !== activation || this.getWorkspaceId() !== workspaceId) throw new Error('Workspace or plugin changed while opening view');
    if (this.sessions.size >= 32) throw new Error('Too many open plugin views');
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { pluginId, workspaceId, activation, controller: new AbortController(), directory: posix.dirname(view.entry), assets });
    const base = `${PLUGIN_VIEW_SCHEME}://view/${sessionId}`;
    return { sessionId, workspaceId, assetBaseUrl: `${base}/`, moduleUrl: `${base}/module.mjs`, ...(view.stylesheet ? { stylesheetUrl: `${base}/style.css` } : {}) };
  }

  private session(id: string): ViewSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Plugin view session has closed');
    try {
      if (this.getWorkspaceId() !== session.workspaceId || this.manager.activePlugin(session.pluginId) !== session.activation) throw new Error('Plugin view workspace or activation has changed');
      session.controller.signal.throwIfAborted();
      return session;
    } catch (error) { this.close(id); throw error; }
  }

  asset(url: string): { body: Buffer; contentType: string } | undefined {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== `${PLUGIN_VIEW_SCHEME}:` || parsed.hostname !== 'view' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return;
      const parts = parsed.pathname.split('/');
      if (parts.length !== 3) return;
      return this.session(parts[1]!).assets.get(parts[2]!);
    } catch { return; }
  }

  async assetAsync(url: string): Promise<{ body: Buffer; contentType: string } | undefined> {
    const cached=this.asset(url);if(cached)return cached;
    try {
      const parsed=new URL(url);
      if(parsed.protocol!==`${PLUGIN_VIEW_SCHEME}:`||parsed.hostname!=='view'||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash)return;
      const [,id,...parts]=parsed.pathname.split('/');
      if(!id||!parts.length)return;
      const session=this.session(id),file=decodeURIComponent(parts.join('/'));
      if(file.startsWith('/')||file.includes('\\')||file.split('/').some(part=>!part||part==='.'||part==='..'))return;
      const relative=session.directory==='.'?file:`${session.directory}/${file}`;
      // Renderer modules may use chunks and assets in their own package directory.
      const asset=await verifiedPluginAsset(session.activation.root,session.activation.manifest,relative);
      if(this.session(id)!==session)return;
      return asset;
    }catch{return;}
  }

  async call(id: string, capability: string, method: string, args?: unknown): Promise<unknown> {
    const session = this.session(id);
    const signal = AbortSignal.any([session.controller.signal, AbortSignal.timeout(120_000)]);
    return this.withSignal(signal, () => this.manager.callCapability(session.pluginId, capability, method, args, { workspaceId: session.workspaceId, signal }));
  }

  async execute(id: string, command: string, args?: unknown): Promise<unknown> {
    const session = this.session(id);
    // A command's host work retains its original workspace until it completes.
    return this.withSignal(session.controller.signal, () => this.manager.execute(session.pluginId, command, args, session.workspaceId));
  }

  private withSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Plugin view call was cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      void Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.controller.abort();
    session.assets.clear();
  }
  closeAll(): void {
    this.generation++;
    for (const id of this.sessions.keys()) this.close(id);
  }
  reconcile(): void { for (const id of this.sessions.keys()) { try { this.session(id); } catch { /* revoked */ } } }
}
