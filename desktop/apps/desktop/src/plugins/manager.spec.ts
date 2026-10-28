import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HostToPluginMessage, PluginRequest } from '../../../../packages/plugin-sdk/src';
import { DesktopPluginManager, DesktopPluginProcess } from './manager';
import { DesktopPluginPackageStore } from './package-store';

class FakeProcess implements DesktopPluginProcess {
  listeners = new Set<(message: unknown) => void>();
  exits = new Set<(code: number | null) => void>();
  messages: HostToPluginMessage[] = [];
  killed = false;
  handle: (request: PluginRequest) => void = request => this.reply(request, { accepted: true });
  send(message: HostToPluginMessage): void {
    this.messages.push(message);
    if (message.type === 'request') queueMicrotask(() => this.handle(message));
  }
  reply(request: PluginRequest, result?: unknown, error?: string): void {
    this.emit({ type: 'response', requestId: request.requestId, ok: !error, result, error });
  }
  emit(message: unknown): void { for (const listener of this.listeners) listener(message); }
  onMessage(listener: (message: unknown) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onExit(listener: (code: number | null) => void): () => void { this.exits.add(listener); return () => { this.exits.delete(listener); }; }
  kill(): void { this.killed = true; }
  crash(): void { for (const listener of this.exits) listener(7); }
}

describe('DesktopPluginManager process and capability boundaries', () => {
  let directory: string;
  let store: DesktopPluginPackageStore;
  let manager: DesktopPluginManager;
  let processes: Map<string, FakeProcess>;
  let invoke: jest.Mock;
  let disposeContributions: jest.Mock;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xue-plugin-manager-'));
    store = new DesktopPluginPackageStore(path.join(directory, 'store'));
    processes = new Map();
    invoke = jest.fn(async (_capability, _method, _args, context) => ({ workspaceId: context.workspaceId }));
    disposeContributions = jest.fn();
    manager = new DesktopPluginManager({
      store, processFactory: config => { const worker = new FakeProcess(); processes.set(config.pluginId, worker); return worker; },
      capabilities: { versions: { 'workspace.connection': 1 }, invoke },
      activationTimeoutMs: 100, commandTimeoutMs: 100, disposeTimeoutMs: 50,
      registerContributions: async () => disposeContributions,
    });
  });
  afterEach(async () => {
    for (const worker of processes.values()) worker.handle = request => worker.reply(request);
    await manager.shutdown().catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function install(id: string, requires: Record<string, number> = {}): Promise<void> {
    const source = path.join(directory, id);
    await fs.mkdir(source);
    const code = 'module.exports = {};';
    await fs.writeFile(path.join(source, 'plugin.cjs'), code);
    await fs.writeFile(path.join(source, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, apiVersion: 1, id, name: id, version: '1.0.0', requires,
      runtime: { entry: 'plugin.cjs' }, contributes: { commands: [{ id: 'run', title: 'Run' }] },
      integrity: { 'plugin.cjs': createHash('sha256').update(code).digest('hex') },
    }));
    await manager.install(source);
  }
  it('preflights missing dependencies without loading code and isolates failures', async () => {
    await install('missing', { 'workspace.connection': 2 });
    await install('working');
    await expect(manager.enable('missing')).rejects.toThrow('workspace.connection@2');
    expect(processes.has('missing')).toBe(false);
    await manager.enable('working');
    expect((await manager.list()).map(item => item.status)).toEqual(['failed', 'active']);
    processes.get('working')!.crash();
    await Promise.resolve();
    expect((await manager.list()).find(item => item.manifest.id === 'working')?.status).toBe('failed');
    expect(disposeContributions).toHaveBeenCalledTimes(1);
  });
  it('passes only declared capabilities with the host-bound invocation workspace and revokes stale calls', async () => {
    await install('scoped', { 'workspace.connection': 1 });
    await manager.enable('scoped');
    const worker = processes.get('scoped')!;
    let request: PluginRequest;
    worker.handle = value => { request = value; };
    const result = manager.execute('scoped', 'run', {}, 'workspace-a');
    await Promise.resolve();
    worker.emit({ type: 'capability', requestId: 'cap-1', invocationId: request!.requestId, capability: 'workspace.connection', method: 'get', args: { workspaceId: 'workspace-b' } });
    await Promise.resolve();
    expect(invoke.mock.calls[0][3].workspaceId).toBe('workspace-a');
    worker.emit({ type: 'capability', requestId: 'cap-2', invocationId: request!.requestId, capability: 'secrets.read', method: 'get' });
    expect(worker.messages).toContainEqual(expect.objectContaining({ type: 'capability-result', requestId: 'cap-2', ok: false }));
    worker.reply(request!, 'done');
    await expect(result).resolves.toBe('done');
    expect(invoke.mock.calls[0][3].signal.aborted).toBe(true);
    worker.emit({ type: 'capability', requestId: 'cap-3', invocationId: request!.requestId, capability: 'workspace.connection', method: 'get' });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(worker.messages).toContainEqual(expect.objectContaining({ requestId: 'cap-3', ok: false }));
  });
  it('revokes contributions and process listeners on disable, and prevents active package replacement', async () => {
    await install('cleanup');
    await manager.enable('cleanup');
    await expect(manager.install(path.join(directory, 'cleanup'))).rejects.toThrow('Disable');
    const worker = processes.get('cleanup')!;
    await manager.disable('cleanup');
    expect(worker.killed).toBe(true);
    expect(worker.listeners.size + worker.exits.size).toBe(0);
    expect(disposeContributions).toHaveBeenCalledTimes(1);
    expect((await manager.list())[0].enabled).toBe(false);
    await expect(manager.execute('cleanup', 'run', {}, 'workspace-a')).rejects.toThrow('not active');
  });
  it('keeps a busy worker alive and refuses uninstall until its disposal guard allows it', async () => {
    await install('busy');
    await manager.enable('busy');
    const worker = processes.get('busy')!;
    const previousViewRevision = (await manager.list())[0].viewRevision;
    worker.handle = request => worker.reply(request, undefined, 'Export still running');
    await expect(manager.remove('busy')).rejects.toThrow('Export still running');
    expect(worker.killed).toBe(false);
    expect((await manager.list())[0]).toEqual(expect.objectContaining({ status: 'active', enabled: true }));
    expect((await manager.list())[0].viewRevision).not.toBe(previousViewRevision);
    expect(disposeContributions).not.toHaveBeenCalled();
    worker.handle = request => worker.reply(request);
    await manager.remove('busy');
    expect(worker.killed).toBe(true);
    expect(await manager.list()).toEqual([]);
  });
  it('times out an unresponsive activation and can activate unrelated plugins', async () => {
    await install('timeout');
    await install('healthy');
    const unresponsive = new FakeProcess();
    unresponsive.handle = () => undefined;
    const isolated = new DesktopPluginManager({
      store, processFactory: config => config.pluginId === 'timeout' ? unresponsive : new FakeProcess(),
      capabilities: { versions: {}, invoke }, activationTimeoutMs: 10,
    });
    await expect(isolated.enable('timeout')).rejects.toThrow('timed out');
    expect(unresponsive.killed).toBe(true);
    await isolated.enable('healthy');
    expect((await isolated.list()).map(item => item.status)).toEqual(['failed', 'active']);
    await isolated.shutdown();
    expect((await store.get('healthy')).enabled).toBe(true);
  });
  it('restores enabled plugins independently when one installed bundle is damaged', async () => {
    await install('damaged');
    await install('recoverable');
    await store.setEnabled('damaged', true);
    await store.setEnabled('recoverable', true);
    await fs.rm(path.join((await store.get('damaged')).root, 'plugin.json'));
    expect((await manager.restoreEnabled()).map(item => item.status)).toEqual(['failed', 'active']);
    expect(processes.has('damaged')).toBe(false);
    await manager.remove('damaged');
    expect((await manager.list()).map(item => item.manifest.id)).toEqual(['recoverable']);
  });
  it('waits for process termination before reporting disabled and retains failed handles for retry', async () => {
    await install('termination');
    await manager.enable('termination');
    const worker = processes.get('termination')!;
    const rejectedKill = jest.fn(async () => { throw Error('still alive'); });
    worker.kill = rejectedKill;
    await expect(manager.disable('termination')).rejects.toThrow('still alive');
    expect((await manager.list())[0]).toEqual(expect.objectContaining({ status: 'failed', enabled: true }));
    await expect(manager.enable('termination')).rejects.toThrow('still alive');
    expect(processes.get('termination')).toBe(worker);
    let release: () => void;
    let started: () => void;
    const killing = new Promise<void>(resolve => { started = resolve; });
    worker.kill = () => { started(); return new Promise<void>(resolve => { release = resolve; }); };
    const disabling = manager.disable('termination');
    await killing;
    expect((await store.get('termination')).enabled).toBe(true);
    release!();
    await disabling;
    expect((await manager.list())[0]).toEqual(expect.objectContaining({ status: 'disabled', enabled: false }));
    expect(worker.listeners.size + worker.exits.size).toBe(0);
  });
  it('does not resurrect an exited worker while its enabled preference is being saved', async () => {
    await install('activation.race');
    const original = store.setEnabled.bind(store);
    jest.spyOn(store, 'setEnabled').mockImplementation(async (id, enabled) => {
      await original(id, enabled);
      if (id === 'activation.race' && enabled) processes.get(id)!.crash();
    });
    await expect(manager.enable('activation.race')).rejects.toThrow('process exited');
    expect((await manager.list())[0].status).toBe('failed');
    await expect(manager.execute('activation.race', 'run', null, 'workspace')).rejects.toThrow('not active');
  });
});
