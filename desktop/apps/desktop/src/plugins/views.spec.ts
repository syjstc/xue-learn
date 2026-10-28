import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopPluginManager } from './manager';
import { DesktopPluginPackageStore } from './package-store';
import { DesktopPluginViews } from './views';

describe('embedded plugin view sessions', () => {
  let root: string, workspace: string, store: DesktopPluginPackageStore, manager: DesktopPluginManager, views: DesktopPluginViews;
  const processFactory = jest.fn();
  const invoke = jest.fn();
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'xue-plugin-view-'));
    workspace = 'workspace-a';
    processFactory.mockReset(); invoke.mockReset();
    invoke.mockImplementation(async (_capability, _method, args, context) => ({ args, workspaceId: context.workspaceId }));
    store = new DesktopPluginPackageStore(join(root, 'store'));
    manager = new DesktopPluginManager({ store, processFactory, capabilities: { versions: { 'workspace.courses': 1 }, invoke }, onChange: () => views?.reconcile() });
    views = new DesktopPluginViews(manager, () => workspace);
    const source = join(root, 'source');
    await mkdir(source);
    const assets = { 'view.mjs': 'export function createView(host) { return () => null; }', 'view.css': '.plugin { color: red; }' };
    for (const [name, contents] of Object.entries(assets)) await writeFile(join(source, name), contents);
    await writeFile(join(source, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, apiVersion: 1, id: 'org.example.view', name: 'Embedded', version: '1.0.0',
      requires: { 'workspace.courses': 1 }, contributes: { commands: [], views: [{ id: 'course', title: 'Course', entry: 'view.mjs', stylesheet: 'view.css' }] },
      integrity: Object.fromEntries(Object.entries(assets).map(([name, contents]) => [name, createHash('sha256').update(contents).digest('hex')])),
    }));
    await manager.install(source);
    await manager.enable('org.example.view');
  });
  afterEach(async () => { views.closeAll(); await manager.shutdown(); await rm(root, { recursive: true, force: true }); });

  it('mounts UI-only packages without creating a process and serves only verified declared assets', async () => {
    const session = await views.open('org.example.view', 'course');
    expect(processFactory).not.toHaveBeenCalled();
    expect(views.asset(session.moduleUrl)?.body.toString()).toContain('createView');
    expect(views.asset(session.stylesheetUrl!)?.contentType).toContain('text/css');
    expect(views.asset(session.moduleUrl.replace('module.mjs', 'plugin.json'))).toBeUndefined();
    expect(views.asset(`${session.moduleUrl}?ignored`)).toBeUndefined();
    expect(views.asset(session.moduleUrl.replace('view/', 'other/'))).toBeUndefined();
    await expect(views.open('org.example.view', 'unknown')).rejects.toThrow('declare');
    views.close(session.sessionId);
    expect(views.asset(session.moduleUrl)).toBeUndefined();
  });
  it('scopes capability calls to the original workspace and rejects undeclared capabilities', async () => {
    const session = await views.open('org.example.view', 'course');
    const result = await views.call(session.sessionId, 'workspace.courses', 'catalog', { workspaceId: 'forged' });
    expect(result).toEqual({ args: { workspaceId: 'forged' }, workspaceId: 'workspace-a' });
    await expect(views.call(session.sessionId, 'private.secrets', 'read')).rejects.toThrow('declare');
    workspace = 'workspace-b';
    await expect(views.call(session.sessionId, 'workspace.courses', 'catalog')).rejects.toThrow('changed');
    expect(views.asset(session.moduleUrl)).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed renderer bundle even when the plugin was already enabled', async () => {
    const installed = await store.get('org.example.view');
    await writeFile(join(installed.root, 'view.mjs'), 'export const tampered = true;');
    await expect(views.open('org.example.view', 'course')).rejects.toThrow('integrity mismatch');
  });
  it('aborts in-flight host calls and revokes assets immediately on disable', async () => {
    invoke.mockImplementation(() => new Promise(() => {}));
    const session = await views.open('org.example.view', 'course');
    const pending = views.call(session.sessionId, 'workspace.courses', 'catalog');
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await Promise.resolve();
    const signal = invoke.mock.calls[0]![3].signal;
    await manager.disable('org.example.view');
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(views.asset(session.moduleUrl)).toBeUndefined();
    await expect(views.call(session.sessionId, 'workspace.courses', 'catalog')).rejects.toThrow('closed');
    await manager.enable('org.example.view');
    expect((await views.open('org.example.view', 'course')).sessionId).not.toBe(session.sessionId);
  });
  it('revokes old sessions on document reload and does not share cached assets across sessions', async () => {
    const first = await views.open('org.example.view', 'course');
    const second = await views.open('org.example.view', 'course');
    views.close(first.sessionId);
    expect(views.asset(second.moduleUrl)).toBeDefined();
    views.closeAll();
    expect(views.asset(second.moduleUrl)).toBeUndefined();
  });
});
