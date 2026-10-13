import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { build } from 'esbuild';
import { DesktopPluginManager, type DesktopPluginManagerOptions } from './manager';
import { DesktopPluginPackageStore } from './package-store';

/** These exercise the bundled Cordis implementation and actual OS process IPC, not mock contexts. */
describe('Cordis plugin worker integration', () => {
  let directory: string;
  let workerEntry: string;
  let store: DesktopPluginPackageStore;
  let manager: DesktopPluginManager;
  let options: DesktopPluginManagerOptions;
  let children: ChildProcess[];
  let invoke: jest.Mock;
  const stderr: string[] = [];
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xue-cordis-worker-'));
    workerEntry = path.join(directory, 'worker.cjs');
    await build({ entryPoints: [path.join(__dirname, 'worker.ts')], outfile: workerEntry, bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'silent' });
  });
  afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  beforeEach(async () => {
    children = [];
    stderr.length = 0;
    store = new DesktopPluginPackageStore(await fs.mkdtemp(path.join(directory, 'store-')));
    invoke = jest.fn(async (_capability, _method, _args, context) => ({ workspaceId: context.workspaceId }));
    options = {
      store, capabilities: { versions: { 'workspace.connection': 1 }, invoke }, activationTimeoutMs: 3000, commandTimeoutMs: 3000,
      processFactory(config) {
        const child = fork(workerEntry, [JSON.stringify(config)], { cwd: config.pluginRoot, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
        children.push(child);
        child.stderr?.on('data', chunk => stderr.push(String(chunk)));
        return {
          send(message) { child.send(message); },
          onMessage(listener) { child.on('message', listener); return () => { child.removeListener('message', listener); }; },
          onExit(listener) { child.on('exit', listener); return () => { child.removeListener('exit', listener); }; },
          kill() { child.kill(); },
        };
      },
    };
    manager = new DesktopPluginManager(options);
  });
  afterEach(async () => {
    await manager.shutdown().catch(() => undefined);
    await Promise.all(children.map(child => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', () => resolve()); child.kill('SIGKILL');
    })));
  });
  async function install(id: string, code: string, commands: string[] = ['run']): Promise<void> {
    const source = await fs.mkdtemp(path.join(directory, 'source-'));
    await fs.writeFile(path.join(source, 'plugin.cjs'), code);
    await fs.writeFile(path.join(source, 'plugin.json'), JSON.stringify({
      schemaVersion: 1, apiVersion: 1, id, version: '1.0.0', name: id,
      runtime: { entry: 'plugin.cjs' }, requires: { 'workspace.connection': 1 },
      contributes: { commands: commands.map(id => ({ id, title: id })) },
      integrity: { 'plugin.cjs': createHash('sha256').update(code).digest('hex') },
    }));
    await manager.install(source);
  }
  it('runs real service injection, scopes capability IPC and awaits effect disposal before re-enabling', async () => {
    await install('real.cordis', `
      const fs = require('node:fs/promises');
      const path = require('node:path');
      module.exports = { name: 'real-cordis', inject: ['desktop'], async apply(ctx, config) {
        await ctx.inject(['desktop'], async child => {
          child.effect(() => child.desktop.registerCommand('run', async (args, invocation) => {
            const result = await invocation.call('workspace.connection', 'get', args);
            return { result, workspaceId: invocation.workspaceId };
          }));
          child.effect(() => async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            await fs.appendFile(path.join(config.storagePath, 'disposals.txt'), 'disposed\\n');
          });
        });
      }};`);
    await manager.enable('real.cordis');
    expect(await manager.execute('real.cordis', 'run', { workspaceId: 'spoofed' }, 'workspace-actual')).toEqual({ result: { workspaceId: 'workspace-actual' }, workspaceId: 'workspace-actual' });
    expect(invoke.mock.calls[0][3].workspaceId).toBe('workspace-actual');
    await manager.disable('real.cordis');
    const journal = path.join(await store.storagePath('real.cordis'), 'disposals.txt');
    expect(await fs.readFile(journal, 'utf8')).toBe('disposed\n');
    await manager.enable('real.cordis');
    await manager.execute('real.cordis', 'run', null, 'workspace-two');
    await manager.disable('real.cordis');
    expect(await fs.readFile(journal, 'utf8')).toBe('disposed\ndisposed\n');
    expect(stderr.join('')).not.toContain('without inject');
  });
  it('keeps a busy Cordis context alive, reports command errors and later disposes successfully', async () => {
    await install('busy.cordis', `module.exports = { inject: ['desktop'], apply(ctx) {
      let busy = false;
      ctx.effect(() => ctx.desktop.beforeDeactivate(() => { if (busy) throw Error('Export is busy'); }));
      ctx.effect(() => ctx.desktop.registerCommand('start', () => { busy = true; return 'started'; }));
      ctx.effect(() => ctx.desktop.registerCommand('finish', () => { busy = false; return 'finished'; }));
      ctx.effect(() => ctx.desktop.registerCommand('explode', () => { throw Error('Command failed safely'); }));
    }};`, ['start', 'finish', 'explode']);
    await manager.enable('busy.cordis');
    await expect(manager.execute('busy.cordis', 'explode', null, 'workspace')).rejects.toThrow('Command failed safely');
    await manager.execute('busy.cordis', 'start', null, 'workspace');
    await expect(manager.disable('busy.cordis')).rejects.toThrow('Export is busy');
    expect((await manager.list())[0].status).toBe('active');
    expect(children[0].killed).toBe(false);
    await manager.execute('busy.cordis', 'finish', null, 'workspace');
    await manager.disable('busy.cordis');
    expect(children[0].killed).toBe(true);
  });
  it('surfaces missing Cordis injections and activation errors without losing healthy workers', async () => {
    await install('missing.cordis', `module.exports = { inject: ['absent'], apply() {} };`);
    await install('broken.cordis', `module.exports = { apply() { throw Error('Activation failed'); } };`);
    await install('healthy.cordis', `module.exports = { inject: ['desktop'], apply(ctx) {
      ctx.effect(() => ctx.desktop.registerCommand('run', () => 'healthy'));
    }};`);
    await expect(manager.enable('missing.cordis')).rejects.toThrow('did not activate');
    await expect(manager.enable('broken.cordis')).rejects.toThrow('Activation failed');
    await manager.enable('healthy.cordis');
    expect(await manager.execute('healthy.cordis', 'run', null, 'workspace')).toBe('healthy');
    expect((await manager.list()).map(item => item.status)).toEqual(['failed', 'failed', 'active']);
  });
  it('installs and runs the independent official workspace inspector example', async () => {
    const example = path.resolve(__dirname, '../../../../examples/plugins/workspace-inspector');
    invoke.mockImplementationOnce(async (_capability, _method, _args, context) => ({ workspaceId: context.workspaceId, brokerPath: '/workspace-broker' }));
    const installed = await manager.install(example);
    expect(installed.enabled).toBe(false);
    await manager.enable(installed.manifest.id);
    expect(await manager.execute(installed.manifest.id, 'workspace.inspect', null, 'example-workspace')).toEqual({ workspaceId: 'example-workspace', connected: true });
    await manager.remove(installed.manifest.id);
    expect(await manager.list()).toEqual([]);
  });
  it('retries a disposal acknowledgement timeout without replaying Cordis teardown', async () => {
    options.disposeTimeoutMs = 10;
    await install('slow.dispose', `
      const fs = require('node:fs/promises');
      const path = require('node:path');
      module.exports = { inject: ['desktop'], apply(ctx, config) {
        ctx.effect(() => ctx.desktop.registerCommand('run', () => null));
        ctx.effect(() => async () => {
          await new Promise(resolve => setTimeout(resolve, 80));
          await fs.appendFile(path.join(config.storagePath, 'disposals.txt'), 'disposed\\n');
        });
      }};`);
    await manager.enable('slow.dispose');
    await expect(manager.disable('slow.dispose')).rejects.toThrow('timed out');
    expect(children[0].killed).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 120));
    options.disposeTimeoutMs = 1000;
    await manager.disable('slow.dispose');
    expect(await fs.readFile(path.join(await store.storagePath('slow.dispose'), 'disposals.txt'), 'utf8')).toBe('disposed\n');
    expect((await manager.list())[0].status).toBe('disabled');
  });
});
