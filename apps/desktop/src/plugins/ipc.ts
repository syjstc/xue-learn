import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isPluginIdentifier } from '../../../../packages/plugin-sdk/src/index';
import type { DesktopPluginManager } from './manager';
import { PLUGIN_IPC } from './channels';
import type { DesktopPluginViews } from './views';

export interface PluginIpcOptions {
  manager: DesktopPluginManager;
  views?: DesktopPluginViews;
  isTrustedSender(event: IpcMainInvokeEvent): boolean;
  getWorkspaceId(): string;
  isQuitting(): boolean;
}
/** Only the Desktop main frame can install code or select a workspace for a command. */
export function registerPluginIpc(options: PluginIpcOptions): () => void {
  const validate = (event: IpcMainInvokeEvent) => {
    if (!options.isTrustedSender(event)) throw Error('Plugin management requires the Desktop main window');
    if (options.isQuitting()) throw Error('Desktop is preparing to quit');
  };
  const identifier = (raw: unknown) => { if (!isPluginIdentifier(raw)) throw Error('Invalid plugin identifier'); return raw; };
  const list = async () => (await options.manager.list()).map(plugin => ({
    ...plugin, viewRevision: `${plugin.viewRevision ?? ''}:${options.views?.revision ?? 0}`,
  }));
  ipcMain.handle(PLUGIN_IPC.list, event => { validate(event); return list(); });
  ipcMain.handle(PLUGIN_IPC.install, async event => {
    validate(event);
    const selection = await dialog.showOpenDialog({ title: 'Install Desktop plugin', properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return null;
    validate(event);
    await options.manager.install(selection.filePaths[0]);
    return list();
  });
  for (const method of ['enable', 'disable', 'remove'] as const) {
    ipcMain.handle(PLUGIN_IPC[method], async (event, id: unknown) => {
      validate(event);
      await options.manager[method](identifier(id));
      return list();
    });
  }
  ipcMain.handle(PLUGIN_IPC.execute, (event, id: unknown, command: unknown, args?: unknown) => {
    validate(event);
    return options.manager.execute(identifier(id), identifier(command), args, options.getWorkspaceId());
  });
  const viewSession = (raw: unknown) => {
    if (typeof raw !== 'string' || !/^[a-f0-9-]{36}$/.test(raw)) throw Error('Invalid plugin view session');
    return raw;
  };
  const views = () => { if (!options.views) throw Error('Embedded plugin views are unavailable'); return options.views; };
  ipcMain.handle(PLUGIN_IPC.openView, (event, id: unknown, viewId: unknown) => {
    validate(event);
    return views().open(identifier(id), identifier(viewId));
  });
  ipcMain.handle(PLUGIN_IPC.callView, (event, session: unknown, capability: unknown, method: unknown, args?: unknown) => {
    validate(event);
    if (typeof method !== 'string' || !/^[a-zA-Z][a-zA-Z0-9.-]{0,100}$/.test(method)) throw Error('Invalid capability method');
    return views().call(viewSession(session), identifier(capability), method, args);
  });
  ipcMain.handle(PLUGIN_IPC.executeView, (event, session: unknown, command: unknown, args?: unknown) => {
    validate(event);
    return views().execute(viewSession(session), identifier(command), args);
  });
  ipcMain.handle(PLUGIN_IPC.closeView, (event, session: unknown) => {
    // Revocation must remain available while Desktop is preparing to quit.
    if (!options.isTrustedSender(event)) throw Error('Plugin management requires the Desktop main window');
    return views().close(viewSession(session));
  });
  return () => { for (const channel of Object.values(PLUGIN_IPC)) ipcMain.removeHandler(channel); };
}
