import { ipcMain } from "electron";
import { DESKTOP_IPC } from "./channels.ts";
import { registerDesktopIpc, type DesktopIpcDependencies } from "./ipc.ts";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn() },
  dialog: {}, shell: {},
}));

test("learning registration exposes system capabilities and never installs tool production authorities", () => {
  const cleanup = registerDesktopIpc({} as DesktopIpcDependencies);
  const channels = (ipcMain.handle as jest.Mock).mock.calls.map(([channel]) => channel);
  expect(channels).toEqual(expect.arrayContaining([
    DESKTOP_IPC.runtimeDescriptor, DESKTOP_IPC.workspaceList,
    DESKTOP_IPC.credentialStatuses, DESKTOP_IPC.personalSyncProgress,
    DESKTOP_IPC.htmlPlaygroundRegister,
  ]));
  expect(channels.some(channel => /godot|production|export/.test(channel))).toBe(false);
  cleanup();
  expect((ipcMain.removeHandler as jest.Mock).mock.calls.map(([channel]) => channel).sort())
    .toEqual([...channels].sort());
});
