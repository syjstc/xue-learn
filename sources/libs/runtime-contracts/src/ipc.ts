import { z } from "zod";
import type { CredentialMutation, CredentialStatus } from "./providers.js";
import type {
  EmbeddingModelDownloadSource,
  EmbeddingModelInstallStatus,
} from "./embedding-model.js";
import type { RuntimeDescriptor } from "./runtime.js";
import type {
  WorkspaceCreateInput,
  WorkspaceSummary,
  WorkspaceSwitchInput,
  PersonalSyncConnectInput,
  PersonalSyncPassphraseChange,
  PersonalSyncUnlockInput,
  PersonalSyncProgress,
  SyncLeaseAction,
  SyncWorkspaceDirectory,
  PersonalSyncFolderInput,
  WorkspaceJoinInput,
} from "./personal-sync.js";

export const DESKTOP_BRIDGE_VERSION = 2 as const;

export const sidecarHealthSchema = z.object({
  status: z.enum(["starting", "ready", "restarting", "failed", "stopped"]),
  instanceId: z.string().min(1).nullable(),
  baseUrl: z.string().url().nullable(),
  schemaVersion: z.number().int().nonnegative().nullable(),
  lastError: z.string().nullable(),
});
export type SidecarHealth = z.infer<typeof sidecarHealthSchema>;

export const pickedPathSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
});
export type PickedPath = z.infer<typeof pickedPathSchema>;

export const codexAuthStatusSchema = z.object({
  signedIn: z.boolean(),
  accountId: z.string().nullable(),
  expiresAt: z.number().int().nonnegative().nullable(),
  pendingLogin: z
    .object({
      id: z.string().uuid(),
      verificationUrl: z.string().url(),
      userCode: z.string().min(1),
      expiresAt: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type CodexAuthStatus = z.infer<typeof codexAuthStatusSchema>;

export const codexLoginChallengeSchema = z.object({
  id: z.string().uuid(),
  verificationUrl: z.string().url(),
  userCode: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
});
export type CodexLoginChallenge = z.infer<typeof codexLoginChallengeSchema>;

export type HtmlPlaygroundRegistration = {
  documentId: string;
  src: string;
};

export interface XueLearnDesktopBridge {
  readonly version: typeof DESKTOP_BRIDGE_VERSION;
  runtime: {
    getDescriptor(): Promise<RuntimeDescriptor>;
  };
  sidecar: {
    getHealth(): Promise<SidecarHealth>;
    restart(): Promise<SidecarHealth>;
    resetDevelopmentData(): Promise<SidecarHealth>;
  };
  credentials: {
    getStatuses(): Promise<CredentialStatus[]>;
    mutate(input: CredentialMutation): Promise<CredentialStatus[]>;
    cloneProvider(
      fromProviderId: string,
      toProviderId: string,
    ): Promise<CredentialStatus[]>;
    clearProvider(providerId: string): Promise<CredentialStatus[]>;
  };
  codexAuth: {
    status(): Promise<CodexAuthStatus>;
    startLogin(): Promise<CodexLoginChallenge>;
    cancelLogin(): Promise<void>;
    logout(): Promise<void>;
  };
  embeddingModel: {
    getStatus(): Promise<EmbeddingModelInstallStatus>;
    install(
      source: EmbeddingModelDownloadSource,
    ): Promise<EmbeddingModelInstallStatus>;
  };
  dialog: {
    pickFile(): Promise<PickedPath | null>;
    pickDirectory(): Promise<PickedPath | null>;
  };
  external: {
    openHttpsUrl(url: string): Promise<void>;
  };
  resources: {
    open(storageKey: string): Promise<void>;
    reveal(storageKey: string): Promise<void>;
  };
  workspaces: {
    list(): Promise<WorkspaceSummary[]>;
    create(input: WorkspaceCreateInput): Promise<WorkspaceSummary>;
    switch(input: WorkspaceSwitchInput): Promise<WorkspaceSummary>;
  };
  /**
   * Optional while a running desktop preload is upgraded by an app restart.
   * Serves course `interactive_html` on `xuelearn-html:` so srcDoc does not
   * inherit the renderer `script-src 'self'` policy.
   */
  htmlPlayground?: {
    register(html: string): Promise<HtmlPlaygroundRegistration>;
    release(documentId: string): Promise<void>;
  };
  personalSync: {
    /** Optional while a running desktop preload is upgraded by an app restart. */
    getProgress?(): Promise<PersonalSyncProgress>;
    connect(input: PersonalSyncConnectInput): Promise<void>;
    unlock(input: PersonalSyncUnlockInput): Promise<void>;
    changePassphrase(input: PersonalSyncPassphraseChange): Promise<void>;
    disconnect(): Promise<void>;
    syncNow(): Promise<void>;
    changeLease(input: SyncLeaseAction): Promise<void>;
    listFolderWorkspaces(
      input: PersonalSyncFolderInput,
    ): Promise<SyncWorkspaceDirectory[]>;
    joinWorkspace(input: WorkspaceJoinInput): Promise<WorkspaceSummary>;
  };
}
