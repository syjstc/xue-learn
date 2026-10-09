import { contextBridge, ipcRenderer } from "electron";
import {
  DESKTOP_BRIDGE_VERSION,
  type CredentialMutation,
  type EmbeddingModelDownloadSource,
  type WorkspaceCreateInput,
  type WorkspaceSwitchInput,
  type PersonalSyncConnectInput,
  type PersonalSyncPassphraseChange,
  type PersonalSyncUnlockInput,
  type PersonalSyncFolderInput,
  type SyncLeaseAction,
  type WorkspaceJoinInput,
  type XueLearnDesktopBridge,
} from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { DESKTOP_IPC } from "./channels.ts";

const bridge = {
  version: DESKTOP_BRIDGE_VERSION,
  runtime: Object.freeze({
    getDescriptor: () => ipcRenderer.invoke(DESKTOP_IPC.runtimeDescriptor),
  }),
  sidecar: Object.freeze({
    getHealth: () => ipcRenderer.invoke(DESKTOP_IPC.sidecarHealth),
    restart: () => ipcRenderer.invoke(DESKTOP_IPC.sidecarRestart),
    resetDevelopmentData: () =>
      ipcRenderer.invoke(DESKTOP_IPC.resetDevelopmentData),
  }),
  credentials: Object.freeze({
    getStatuses: () => ipcRenderer.invoke(DESKTOP_IPC.credentialStatuses),
    mutate: (input: CredentialMutation) =>
      ipcRenderer.invoke(DESKTOP_IPC.credentialMutate, input),
    cloneProvider: (fromProviderId: string, toProviderId: string) =>
      ipcRenderer.invoke(DESKTOP_IPC.credentialClone, {
        fromProviderId,
        toProviderId,
      }),
    clearProvider: (providerId: string) =>
      ipcRenderer.invoke(DESKTOP_IPC.credentialClear, { providerId }),
  }),
  codexAuth: Object.freeze({
    status: () => ipcRenderer.invoke(DESKTOP_IPC.codexAuthStatus),
    startLogin: () => ipcRenderer.invoke(DESKTOP_IPC.codexAuthStart),
    cancelLogin: () => ipcRenderer.invoke(DESKTOP_IPC.codexAuthCancel),
    logout: () => ipcRenderer.invoke(DESKTOP_IPC.codexAuthLogout),
  }),
  embeddingModel: Object.freeze({
    getStatus: () => ipcRenderer.invoke(DESKTOP_IPC.embeddingModelStatus),
    install: (source: EmbeddingModelDownloadSource) =>
      ipcRenderer.invoke(DESKTOP_IPC.embeddingModelInstall, source),
  }),
  dialog: Object.freeze({
    pickFile: () => ipcRenderer.invoke(DESKTOP_IPC.pickFile),
    pickDirectory: () => ipcRenderer.invoke(DESKTOP_IPC.pickDirectory),
  }),
  external: Object.freeze({
    openHttpsUrl: (url: string) =>
      ipcRenderer.invoke(DESKTOP_IPC.openHttpsUrl, url),
  }),
  resources: Object.freeze({
    open: (storageKey: string) =>
      ipcRenderer.invoke(DESKTOP_IPC.openResource, storageKey),
    reveal: (storageKey: string) =>
      ipcRenderer.invoke(DESKTOP_IPC.revealResource, storageKey),
  }),
  workspaces: Object.freeze({
    list: () => ipcRenderer.invoke(DESKTOP_IPC.workspaceList),
    create: (input: WorkspaceCreateInput) =>
      ipcRenderer.invoke(DESKTOP_IPC.workspaceCreate, input),
    switch: (input: WorkspaceSwitchInput) =>
      ipcRenderer.invoke(DESKTOP_IPC.workspaceSwitch, input),
  }),
  htmlPlayground: Object.freeze({
    register: (html: string) =>
      ipcRenderer.invoke(DESKTOP_IPC.htmlPlaygroundRegister, html),
    release: (documentId: string) =>
      ipcRenderer.invoke(DESKTOP_IPC.htmlPlaygroundRelease, documentId),
  }),
  personalSync: Object.freeze({
    getProgress: () => ipcRenderer.invoke(DESKTOP_IPC.personalSyncProgress),
    connect: (input: PersonalSyncConnectInput) =>
      ipcRenderer.invoke(DESKTOP_IPC.personalSyncConnect, input),
    unlock: (input: PersonalSyncUnlockInput) =>
      ipcRenderer.invoke(DESKTOP_IPC.personalSyncUnlock, input),
    changePassphrase: (input: PersonalSyncPassphraseChange) =>
      ipcRenderer.invoke(DESKTOP_IPC.personalSyncChangePassphrase, input),
    disconnect: () => ipcRenderer.invoke(DESKTOP_IPC.personalSyncDisconnect),
    syncNow: () => ipcRenderer.invoke(DESKTOP_IPC.personalSyncNow),
    changeLease: (input: SyncLeaseAction) =>
      ipcRenderer.invoke(DESKTOP_IPC.personalSyncLease, input),
    listFolderWorkspaces: (input: PersonalSyncFolderInput) =>
      ipcRenderer.invoke(DESKTOP_IPC.personalSyncFolderWorkspaces, input),
    joinWorkspace: (input: WorkspaceJoinInput) =>
      ipcRenderer.invoke(DESKTOP_IPC.personalSyncJoinWorkspace, input),
  }),
};

contextBridge.exposeInMainWorld(
  "xueLearnDesktop",
  Object.freeze(bridge) as XueLearnDesktopBridge,
);
