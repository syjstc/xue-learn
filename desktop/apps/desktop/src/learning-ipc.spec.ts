import { ipcMain } from "electron";
import { DESKTOP_IPC } from "./channels.ts";
import { registerDesktopIpc, type DesktopIpcDependencies } from "./ipc.ts";
import { isTrustedDesktopSender } from "./security.ts";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn() },
  dialog: {}, shell: {},
}));

beforeEach(() => jest.clearAllMocks());

test("every native IPC capability rejects an untrusted caller before touching dependencies", () => {
  const isTrustedSender = jest.fn(() => false);
  registerDesktopIpc({ isTrustedSender } as unknown as DesktopIpcDependencies);
  for (const [, handler] of (ipcMain.handle as jest.Mock).mock.calls) {
    expect(() => handler({ senderFrame: null })).toThrow("Untrusted desktop IPC sender");
  }
  expect(isTrustedSender).toHaveBeenCalledTimes((ipcMain.handle as jest.Mock).mock.calls.length);
});

test("the trusted app frame can still request its runtime descriptor", () => {
  const runtime = { hostKind: "desktop-local" };
  registerDesktopIpc({ isTrustedSender: () => true, runtime } as unknown as DesktopIpcDependencies);
  const [, handler] = (ipcMain.handle as jest.Mock).mock.calls.find(([channel]) => channel === DESKTOP_IPC.runtimeDescriptor)!;
  expect(handler({})).toBe(runtime);
});

test("trust requires the live app window, its main frame, and the current exact loopback origin", () => {
  const frame = { url: "http://127.0.0.1:43123/learn" };
  const webContents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow;
  const event = { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const origins = ["http://127.0.0.1:43123"];
  expect(isTrustedDesktopSender(event, window, origins)).toBe(true);
  expect(isTrustedDesktopSender(event, null, origins)).toBe(false);
  expect(isTrustedDesktopSender(event, { ...window, isDestroyed: () => true } as BrowserWindow, origins)).toBe(false);
  expect(isTrustedDesktopSender({ ...event, sender: {} } as IpcMainInvokeEvent, window, origins)).toBe(false);
  expect(isTrustedDesktopSender({ ...event, senderFrame: { ...frame } } as IpcMainInvokeEvent, window, origins)).toBe(false);
  expect(isTrustedDesktopSender({ ...event, senderFrame: null } as IpcMainInvokeEvent, window, origins)).toBe(false);
  for (const url of ["https://example.com", "http://127.0.0.1:43124/", "http://127.0.0.1.evil.example:43123/", "xuelearn-html://content/"]) {
    frame.url = url;
    expect(isTrustedDesktopSender(event, window, origins)).toBe(false);
  }
});

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
