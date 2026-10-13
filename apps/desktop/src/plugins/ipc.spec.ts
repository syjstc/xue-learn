const handlers = new Map<string, (...args: any[]) => unknown>();
const pick = jest.fn();
jest.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: any[]) => unknown) => handlers.set(name, fn),
    removeHandler: (name: string) => handlers.delete(name),
  },
  dialog: { showOpenDialog: (...args: unknown[]) => pick(...args) },
}));
import { registerPluginIpc } from './ipc';
import { PLUGIN_IPC } from './channels';
import type { DesktopPluginManager } from './manager';
import type { DesktopPluginViews } from './views';
import { pluginEnvironment } from './electron-process';

describe('plugin management authority boundary', () => {
  beforeEach(() => { handlers.clear(); pick.mockReset(); });
  function setup() {
    const manager = { list: jest.fn(async () => []), install: jest.fn(), enable: jest.fn(), disable: jest.fn(), remove: jest.fn(), execute: jest.fn() };
    const views = { open: jest.fn(), call: jest.fn(), execute: jest.fn(), close: jest.fn() };
    let workspace = 'workspace-a';
    let quitting = false;
    const dispose = registerPluginIpc({
      manager: manager as unknown as DesktopPluginManager,
      views: views as unknown as DesktopPluginViews,
      isTrustedSender: event => (event as unknown as { trusted?: boolean }).trusted === true,
      getWorkspaceId: () => workspace, isQuitting: () => quitting,
    });
    return { manager, views, dispose, select: (value: string) => { workspace = value; }, quit: () => { quitting = true; } };
  }
  it('rejects untrusted frames before exposing packages or opening a file picker', async () => {
    const { manager } = setup();
    expect(() => handlers.get(PLUGIN_IPC.list)!({})).toThrow('main window');
    await expect(handlers.get(PLUGIN_IPC.install)!({})).rejects.toThrow('main window');
    expect(manager.list).not.toHaveBeenCalled(); expect(pick).not.toHaveBeenCalled();
  });
  it('binds commands to the host-selected workspace, ignoring a workspace in plugin arguments', () => {
    const { manager, select } = setup();
    const args = { workspaceId: 'forged' };
    handlers.get(PLUGIN_IPC.execute)!({ trusted: true }, 'org.example.plugin', 'inspect', args);
    expect(manager.execute).toHaveBeenLastCalledWith('org.example.plugin', 'inspect', args, 'workspace-a');
    select('workspace-b');
    handlers.get(PLUGIN_IPC.execute)!({ trusted: true }, 'org.example.plugin', 'inspect', args);
    expect(manager.execute).toHaveBeenLastCalledWith('org.example.plugin', 'inspect', args, 'workspace-b');
  });
  it('cancels installation without a write and rechecks quit after a native dialog', async () => {
    const { manager, quit } = setup();
    pick.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(handlers.get(PLUGIN_IPC.install)!({ trusted: true })).resolves.toBeNull();
    expect(manager.install).not.toHaveBeenCalled();
    pick.mockImplementationOnce(async () => { quit(); return { canceled: false, filePaths: ['/package'] }; });
    await expect(handlers.get(PLUGIN_IPC.install)!({ trusted: true })).rejects.toThrow('preparing to quit');
    expect(manager.install).not.toHaveBeenCalled();
  });
  it('unregisters all management handlers', () => {
    const { dispose } = setup(); dispose(); expect(handlers.size).toBe(0);
  });
  it('only permits the trusted host frame to open and call a view, and keeps revocation available during quit', () => {
    const { views, quit } = setup();
    const session = '12345678-1234-1234-1234-123456789abc';
    expect(() => handlers.get(PLUGIN_IPC.openView)!({}, 'org.example.view', 'courses')).toThrow('main window');
    expect(() => handlers.get(PLUGIN_IPC.callView)!({}, session, 'workspace.courses', 'catalog')).toThrow('main window');
    expect(() => handlers.get(PLUGIN_IPC.callView)!({ trusted: true }, 'invalid', 'workspace.courses', 'catalog')).toThrow('session');
    expect(() => handlers.get(PLUGIN_IPC.callView)!({ trusted: true }, session, 'workspace.courses', '__proto__')).toThrow('method');
    handlers.get(PLUGIN_IPC.openView)!({ trusted: true }, 'org.example.view', 'courses');
    handlers.get(PLUGIN_IPC.callView)!({ trusted: true }, session, 'workspace.courses', 'readUnit', { unitId: 'unit' });
    expect(views.call).toHaveBeenCalledWith(session, 'workspace.courses', 'readUnit', { unitId: 'unit' });
    quit();
    expect(() => handlers.get(PLUGIN_IPC.executeView)!({ trusted: true }, session, 'run')).toThrow('preparing to quit');
    handlers.get(PLUGIN_IPC.closeView)!({ trusted: true }, session);
    expect(views.close).toHaveBeenCalledWith(session);
  });
  it('does not pass model credentials, loader flags or host app configuration to plugin workers', () => {
    expect(pluginEnvironment({ HOME: '/home/test', PATH: '/usr/bin', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--require=hook', XUELEARN_DESKTOP_DATA_PATH: '/private-data' }))
      .toEqual({ HOME: '/home/test', PATH: '/usr/bin' });
  });
});
