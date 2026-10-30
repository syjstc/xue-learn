import { basename, resolve, sep } from "node:path";
import { stat } from "node:fs/promises";
import {
  credentialMutationSchema,
  embeddingModelDownloadSourceSchema,
  workspaceCreateInputSchema,
  workspaceSwitchInputSchema,
  personalSyncConnectInputSchema,
  personalSyncFolderInputSchema,
  personalSyncPassphraseChangeSchema,
  personalSyncUnlockInputSchema,
  syncLeaseActionSchema,
  workspaceJoinInputSchema,
  type RuntimeDescriptor,
  type SidecarHealth,
} from "@xue-learn/core/runtime-contracts";
import { dialog, ipcMain, shell, type WebContents } from "electron";
import { z } from "zod";
import { DESKTOP_IPC } from "./channels.ts";
import type { CredentialVault } from "./credential-vault.ts";
import type { CodexAuthBroker } from "./codex-auth-broker.ts";
import type { EmbeddingModelManager } from "./embedding-model-manager.ts";
import type { WorkspaceCatalog } from "./workspace-catalog.ts";
import type { PersonalSyncKeyManager } from "./personal-sync-keys.ts";
import type { FolderPersonalSyncCoordinator } from "./folder-personal-sync-coordinator.ts";
import type { InteractiveHtmlPlayground } from "./interactive-html-store.ts";
import { renderReadingPdf } from "./reading-pdf.ts";
import {
  listProviderModels,
  modelCatalogRequestSchema,
  providerCredentialsForSave,
} from "./provider-model-catalog";
import { customChatProfileCredentialProviderId } from "@xue-learn/core/runtime-contracts";

export type DesktopIpcDependencies = {
  runtime: RuntimeDescriptor;
  getHealth: () => SidecarHealth;
  restart: () => Promise<SidecarHealth>;
  resetDevelopmentData: () => Promise<SidecarHealth>;
  vault: CredentialVault;
  codexAuth: CodexAuthBroker;
  embeddingModelManager: EmbeddingModelManager;
  afterCredentialMutation: () => Promise<void>;
  workspaceCatalog: WorkspaceCatalog;
  afterWorkspaceSwitch: () => Promise<void>;
  getResourceRoot: () => string;
  getUserDataPath: () => string;
  personalSyncKeys: PersonalSyncKeyManager;
  personalSyncCoordinator: FolderPersonalSyncCoordinator;
  htmlPlayground: InteractiveHtmlPlayground;
};

const RESOURCE_KEY_PATTERN =
  /^[a-f0-9]{2}\/[a-f0-9]{64}\/original\.(?:pdf|txt|md|markdown|doc|docx)$/;

async function requireResourcePath(
  root: string,
  raw: unknown,
): Promise<string> {
  if (typeof raw !== "string" || !RESOURCE_KEY_PATTERN.test(raw)) {
    throw new Error("Invalid local resource key");
  }
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, ...raw.split("/"));
  if (!target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Local resource path escapes its storage root");
  }
  const info = await stat(target);
  if (!info.isFile()) throw new Error("Local resource is not a file");
  return target;
}

function requireHttpsUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Expected an HTTPS URL");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Only credential-free HTTPS URLs are allowed");
  return url.toString();
}

export function registerDesktopIpc(
  dependencies: DesktopIpcDependencies,
): () => void {
  const handleChannels = Object.values(DESKTOP_IPC);
  ipcMain.handle(DESKTOP_IPC.providerModels, async (_event, raw: unknown) =>
    listProviderModels(raw, await dependencies.vault.readForSidecar()),
  );
  ipcMain.handle(
    DESKTOP_IPC.providerCredentialSave,
    async (_event, raw: unknown) => {
      const input = modelCatalogRequestSchema.parse(raw);
      if (input.providerId === "codex" || input.providerId === "ollama")
        return dependencies.vault.getStatuses();
      const previous = await dependencies.vault.readForSidecar();
      const custom = input.providerId === "custom";
      const values = providerCredentialsForSave(input, previous);
      const target =
        custom && input.customProfileId
          ? customChatProfileCredentialProviderId(input.customProfileId)
          : input.providerId;
      await dependencies.vault.mutate(
        credentialMutationSchema.parse({
          action: "set",
          providerId: target,
          values,
        }),
      );
      // Persist a generic endpoint and its active compatibility slot atomically
      // before a single restart; the renderer may navigate during that restart.
      if (custom && target !== "custom")
        await dependencies.vault.cloneProvider(target, "custom");
      const statuses = await dependencies.vault.getStatuses();
      setTimeout(
        () =>
          void dependencies.afterCredentialMutation().catch(() => undefined),
        0,
      );
      return statuses;
    },
  );
  ipcMain.handle(DESKTOP_IPC.readingPdf, (_event, raw: unknown) =>
    renderReadingPdf(raw),
  );
  ipcMain.handle(DESKTOP_IPC.runtimeDescriptor, () => dependencies.runtime);
  ipcMain.handle(DESKTOP_IPC.sidecarHealth, () => dependencies.getHealth());
  ipcMain.handle(DESKTOP_IPC.sidecarRestart, () => dependencies.restart());
  ipcMain.handle(DESKTOP_IPC.resetDevelopmentData, () =>
    dependencies.resetDevelopmentData(),
  );
  ipcMain.handle(DESKTOP_IPC.credentialStatuses, () =>
    dependencies.vault.getStatuses(),
  );
  ipcMain.handle(DESKTOP_IPC.credentialMutate, async (_event, raw: unknown) => {
    const result = await dependencies.vault.mutate(
      credentialMutationSchema.parse(raw),
    );
    // Let the IPC response reach the old renderer before restart navigation
    // destroys its execution context. Health/recovery remains supervisor-owned.
    setTimeout(
      () => void dependencies.afterCredentialMutation().catch(() => undefined),
      0,
    );
    return result;
  });
  ipcMain.handle(DESKTOP_IPC.credentialClone, async (_event, raw: unknown) => {
    const input = z
      .object({
        fromProviderId: z.string().min(1),
        toProviderId: z.string().min(1),
      })
      .parse(raw);
    const result = await dependencies.vault.cloneProvider(
      input.fromProviderId,
      input.toProviderId,
    );
    setTimeout(
      () => void dependencies.afterCredentialMutation().catch(() => undefined),
      0,
    );
    return result;
  });
  ipcMain.handle(DESKTOP_IPC.credentialClear, async (_event, raw: unknown) => {
    const input = z.object({ providerId: z.string().min(1) }).parse(raw);
    const result = await dependencies.vault.clearProvider(input.providerId);
    setTimeout(
      () => void dependencies.afterCredentialMutation().catch(() => undefined),
      0,
    );
    return result;
  });
  ipcMain.handle(DESKTOP_IPC.codexAuthStatus, () =>
    dependencies.codexAuth.status(),
  );
  ipcMain.handle(DESKTOP_IPC.codexAuthStart, () =>
    dependencies.codexAuth.startLogin(),
  );
  ipcMain.handle(DESKTOP_IPC.codexAuthCancel, () =>
    dependencies.codexAuth.cancelLogin(),
  );
  ipcMain.handle(DESKTOP_IPC.codexAuthLogout, () =>
    dependencies.codexAuth.logout(),
  );
  ipcMain.handle(DESKTOP_IPC.embeddingModelStatus, () =>
    dependencies.embeddingModelManager.getStatus(),
  );
  ipcMain.handle(DESKTOP_IPC.embeddingModelInstall, (_event, raw: unknown) =>
    dependencies.embeddingModelManager.install(
      embeddingModelDownloadSourceSchema.parse(raw),
    ),
  );
  ipcMain.handle(DESKTOP_IPC.pickFile, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"] });
    const path = result.filePaths[0];
    return result.canceled || !path ? null : { path, name: basename(path) };
  });
  ipcMain.handle(DESKTOP_IPC.pickDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    const path = result.filePaths[0];
    return result.canceled || !path ? null : { path, name: basename(path) };
  });
  ipcMain.handle(DESKTOP_IPC.openHttpsUrl, (_event, raw: unknown) =>
    shell.openExternal(requireHttpsUrl(raw)),
  );
  ipcMain.handle(DESKTOP_IPC.openResource, async (_event, raw: unknown) => {
    const path = await requireResourcePath(dependencies.getResourceRoot(), raw);
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  ipcMain.handle(DESKTOP_IPC.revealResource, async (_event, raw: unknown) => {
    const path = await requireResourcePath(dependencies.getResourceRoot(), raw);
    shell.showItemInFolder(path);
  });
  ipcMain.handle(DESKTOP_IPC.workspaceList, async () => {
    const workspaces = dependencies.workspaceCatalog.list();
    const locked = new Set(
      (
        await Promise.all(
          workspaces.map(async (workspace) =>
            (await dependencies.personalSyncKeys.isLocked(
              workspace.workspaceId,
            ))
              ? workspace.workspaceId
              : null,
          ),
        )
      ).filter((value): value is string => value !== null),
    );
    return dependencies.workspaceCatalog.list(locked);
  });
  ipcMain.handle(DESKTOP_IPC.workspaceCreate, (_event, raw: unknown) => {
    const input = workspaceCreateInputSchema.parse(raw);
    return dependencies.workspaceCatalog.create(input.name);
  });
  ipcMain.handle(DESKTOP_IPC.workspaceSwitch, async (_event, raw: unknown) => {
    const input = workspaceSwitchInputSchema.parse(raw);
    let workspace;
    try {
      workspace = await dependencies.workspaceCatalog.switchTo(
        input.workspaceId,
      );
    } catch (error) {
      throw error;
    }
    setTimeout(
      () => void dependencies.afterWorkspaceSwitch().catch(() => undefined),
      0,
    );
    return workspace;
  });
  const restartAfterKeyMutation = async (mutation: () => Promise<void>) => {
    await mutation();
    setTimeout(
      () => void dependencies.afterWorkspaceSwitch().catch(() => undefined),
      0,
    );
  };
  ipcMain.handle(
    DESKTOP_IPC.personalSyncConnect,
    async (_event, raw: unknown) => {
      const input = personalSyncConnectInputSchema.parse(raw);
      await dependencies.personalSyncCoordinator.selectFolder(input.folderPath);
      const bootstrap = await dependencies.personalSyncKeys.connect(input);
      await dependencies.personalSyncCoordinator.publishWorkspaceDirectory(
        bootstrap,
      );
      setTimeout(
        () => void dependencies.afterWorkspaceSwitch().catch(() => undefined),
        0,
      );
    },
  );
  ipcMain.handle(DESKTOP_IPC.personalSyncUnlock, (_event, raw: unknown) =>
    restartAfterKeyMutation(() =>
      dependencies.personalSyncKeys.unlock(
        personalSyncUnlockInputSchema.parse(raw),
      ),
    ),
  );
  ipcMain.handle(
    DESKTOP_IPC.personalSyncChangePassphrase,
    async (_event, raw: unknown) => {
      const bootstrap = await dependencies.personalSyncKeys.changePassphrase(
        personalSyncPassphraseChangeSchema.parse(raw),
      );
      await dependencies.personalSyncCoordinator.publishWorkspaceDirectory(
        bootstrap,
      );
    },
  );
  ipcMain.handle(DESKTOP_IPC.personalSyncDisconnect, async () => {
    await dependencies.personalSyncCoordinator.disableRuntime();
    await dependencies.personalSyncKeys.disconnect();
  });
  ipcMain.handle(DESKTOP_IPC.personalSyncProgress, () =>
    dependencies.personalSyncCoordinator.getProgress(),
  );
  ipcMain.handle(DESKTOP_IPC.personalSyncNow, () =>
    dependencies.personalSyncCoordinator.syncNow(),
  );
  ipcMain.handle(DESKTOP_IPC.personalSyncLease, (_event, raw: unknown) => {
    return dependencies.personalSyncCoordinator.changeLease(
      syncLeaseActionSchema.parse(raw),
    );
  });
  ipcMain.handle(
    DESKTOP_IPC.personalSyncFolderWorkspaces,
    (_event, raw: unknown) => {
      const input = personalSyncFolderInputSchema.parse(raw);
      return dependencies.personalSyncCoordinator.listFolderWorkspaces(
        input.folderPath,
      );
    },
  );
  ipcMain.handle(
    DESKTOP_IPC.personalSyncJoinWorkspace,
    async (_event, raw: unknown) => {
      const input = workspaceJoinInputSchema.parse(raw);
      const [bootstrap, syncFolderPath] = await Promise.all([
        dependencies.personalSyncCoordinator.getFolderWorkspaceBootstrap(
          input.folderPath,
          input.workspaceId,
        ),
        dependencies.personalSyncCoordinator.prepareFolder(input.folderPath),
      ]);
      await dependencies.personalSyncKeys.join({
        workspaceId: input.workspaceId,
        passphrase: input.passphrase,
        wrappedWorkspaceKey: bootstrap.wrappedWorkspaceKey,
        encryptedName: bootstrap.encryptedName,
        syncFolderPath,
      });
      return dependencies.workspaceCatalog
        .list()
        .find((item) => item.workspaceId === input.workspaceId)!;
    },
  );
  const watchedSenders = new WeakSet<WebContents>();
  const watchSender = (sender: WebContents) => {
    if (watchedSenders.has(sender)) return;
    watchedSenders.add(sender);
    sender.once("destroyed", () => {
      dependencies.htmlPlayground.releaseAll(sender.id);
    });
  };
  ipcMain.handle(DESKTOP_IPC.htmlPlaygroundRegister, (event, raw: unknown) => {
    watchSender(event.sender);
    return dependencies.htmlPlayground.register(event.sender.id, raw);
  });
  ipcMain.handle(DESKTOP_IPC.htmlPlaygroundRelease, (event, raw: unknown) => {
    dependencies.htmlPlayground.release(event.sender.id, raw);
  });

  return () =>
    handleChannels.forEach((channel) => ipcMain.removeHandler(channel));
}
