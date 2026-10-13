import { join, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import {
  DESKTOP_LOCAL_CAPABILITIES,
  DESKTOP_LOCAL_DATABASE_FILENAME,
  runtimeDescriptorSchema,
  workspaceServiceSessionSchema,
  type SidecarHealth,
  type SyncLeaseScope,
} from "@xue-learn/core/runtime-contracts";
import {
  app,
  BrowserWindow,
  nativeImage,
  safeStorage,
  session,
  shell,
} from "electron";
import { CredentialVault } from "./credential-vault.ts";
import { writeDiagnostic } from "./diagnostic-output.ts";
import { CodexAuthBroker } from "./codex-auth-broker.ts";
import { registerDesktopIpc } from "./ipc.ts";
import { DesktopPluginManager } from "./plugins/manager";
import { DesktopPluginPackageStore } from "./plugins/package-store";
import { createHostPluginProcess } from './plugins/host-process';
import {createPluginNativeServices,DesktopPluginSurfaces,validateNativePluginAbi} from './plugins/native-services';
import {pluginProviderEnvironment} from './plugins/provider-environment';
import { createElectronPluginProcess } from "./plugins/electron-process";
import { DesktopHostCapabilities } from "./plugins/host-capabilities";
import { registerPluginIpc } from "./plugins/ipc";
import { PLUGIN_IPC } from "./plugins/channels";
import { DesktopPluginViews } from './plugins/views';
import { installPluginViewProtocol } from './plugins/view-protocol';
import { registerCorePluginCapabilities } from './plugins/core-capabilities';
import { createWorkspaceClientBroker } from "@xue-learn/core/workspace-client";
import { DESKTOP_IPC } from "./channels.ts";
import { EmbeddingModelManager } from "./embedding-model-manager.ts";
import { activateInstalledBuiltinEmbedding } from "./embedding-model-activation.ts";
import {
  installSessionSecurity,
  lockWindowNavigation,
  sidecarHandoffUrl,
} from "./security.ts";
import { ElectronSidecarProcess } from "./sidecar/electron-process.ts";
import { probeLoopbackHealth } from "./sidecar/health-probe.ts";
import { SidecarSupervisor } from "./sidecar/supervisor.ts";
import { readPinnedSidecarPort } from "./sidecar/reclaim-loopback-listen.ts";
import { shouldLogSidecarOutput } from "./sidecar/utility-process-options.ts";
import { WorkspaceCatalog } from "./workspace-catalog.ts";
import { WorkspaceKeyVault } from "./workspace-key-vault.ts";
import { PersonalSyncKeyManager } from "./personal-sync-keys.ts";
import { FolderPersonalSyncCoordinator } from "./folder-personal-sync-coordinator.ts";
import {
  installInteractiveHtmlProtocol,
  registerInteractiveHtmlScheme,
} from "./interactive-html-protocol.ts";
import { InteractiveHtmlPlayground } from "./interactive-html-store.ts";
import {
  developmentSidecarBuildPath,
  developmentStagedSidecarPath,
  installDevelopmentHotload,
  readDevelopmentRendererOrigin,
} from "./development-hotload.ts";

let mainWindow: BrowserWindow | null = null;
let removeIpcHandlers: (() => void) | null = null;
let removePluginIpcHandlers: (() => void) | null = null;
let removeDevelopmentHotload: (() => void) | null = null;
let scheduledHandoffBaseUrl: string | null = null;
let personalSyncCoordinator: FolderPersonalSyncCoordinator | null = null;
let quitPrepared = false;
let quitRequested = false;
let bootstrapPending = true;
let quitAdmissionPaused = false;
let requestSafeQuit: (() => Promise<void>) | undefined;
let startBackgroundWorkspace: ((workspaceId: string) => Promise<void>) | undefined;
const pendingBackgroundWorkspaces = new Set<string>();
const htmlPlayground = new InteractiveHtmlPlayground();
const developmentRendererOrigin = app.isPackaged
  ? null
  : readDevelopmentRendererOrigin();

function scheduleRendererHandoff(baseUrl: string): void {
  if (developmentRendererOrigin) return;
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    scheduledHandoffBaseUrl === baseUrl
  )
    return;
  const target = sidecarHandoffUrl(mainWindow.webContents.getURL(), baseUrl);
  if (mainWindow.webContents.getURL() === target) return;
  scheduledHandoffBaseUrl = baseUrl;
  setTimeout(() => {
    const window = mainWindow;
    if (!window || window.isDestroyed() || scheduledHandoffBaseUrl !== baseUrl)
      return;
    void window.loadURL(target).finally(() => {
      if (scheduledHandoffBaseUrl === baseUrl) scheduledHandoffBaseUrl = null;
    });
  }, 0);
}

function recoveryDocument(health: SidecarHealth): string {
  const error = health.lastError ?? "The local service is unavailable.";
  const escaped = error.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f5;color:#20201e}.card{max-width:38rem;padding:2rem;border-radius:16px;background:white;box-shadow:0 8px 30px #0001}code{word-break:break-word}</style></head><body><main class="card"><h1>XueLearn needs attention</h1><p>The private local service stopped after repeated recovery attempts.</p><code>${escaped}</code><p>Restart XueLearn. Your local learning data remains on disk.</p></main></body></html>`)}`;
}

async function bootstrap(): Promise<void> {
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(
      nativeImage.createFromPath(
        join(app.getAppPath(), "assets/icon-local.png"),
      ),
    );
  }

  const runtime = runtimeDescriptorSchema.parse({
    schemaVersion: 1,
    kind: "desktop-local",
    os:
      process.platform === "darwin"
        ? "macos"
        : process.platform === "win32"
          ? "windows"
          : "linux",
    arch: process.arch,
    appVersion: app.getVersion(),
    capabilities: DESKTOP_LOCAL_CAPABILITIES,
  });
  const developmentDataPath = process.env.XUELEARN_DESKTOP_DATA_PATH?.trim();
  const userDataPath =
    !app.isPackaged && developmentDataPath
      ? resolve(developmentDataPath)
      : app.getPath("userData");
  const workspaceCatalog = await WorkspaceCatalog.open(userDataPath);
  const serviceOnly = process.argv.includes("--workspace-service");
  const selectedWorkspace = process.argv.find(argument => argument.startsWith("--workspace-id="))?.slice("--workspace-id=".length);
  if (selectedWorkspace) await workspaceCatalog.switchTo(selectedWorkspace);
  const rendererPath = app.isPackaged
    ? join(process.resourcesPath, "desktop-renderer")
    : join(app.getAppPath(), "../../dist-desktop");
  const sidecarEntry = app.isPackaged
    ? join(process.resourcesPath, "local-sidecar", "main.js")
    : join(app.getAppPath(), ".forge-resources/local-sidecar/main.js");
  const resourceRoot = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), ".forge-resources");
  if (!app.isPackaged) process.env.XUELEARN_DESKTOP_DEV = "1";
  const vault = new CredentialVault(
    join(userDataPath, "credentials.v1.enc.json"),
    safeStorage,
  );
  const codexAuth = new CodexAuthBroker(
    join(userDataPath, "codex-auth.v1.enc.json"),
    safeStorage,
  );
  const workspaceKeyVault = new WorkspaceKeyVault(
    join(userDataPath, "workspace-keys.v1.enc.json"),
    safeStorage,
  );
  const personalSyncKeys = new PersonalSyncKeyManager(
    workspaceCatalog,
    workspaceKeyVault,
  );

  let supervisor!: SidecarSupervisor;
  const embeddingModelManager = new EmbeddingModelManager(userDataPath, () =>
    activateInstalledBuiltinEmbedding(supervisor),
  );
  const supervisors = new Map<string, SidecarSupervisor>();
  const createWorkspaceSupervisor = (workspaceId = workspaceCatalog.activeWorkspaceId) => {
    // A retained service keeps its selected workspace even after the UI switches.
    if (quitAdmissionPaused) throw new Error("Workspace services are preparing to quit");
    if (!workspaceCatalog.list().some(workspace => workspace.workspaceId === workspaceId)) throw new Error("Unknown workspace service selection");
    const workspacePath = workspaceCatalog.workspacePath(workspaceId);
    const listenPort = !serviceOnly && supervisors.size === 0 ? readPinnedSidecarPort() ?? 0 : 0;
    const instance = new SidecarSupervisor({
    factory: () => new ElectronSidecarProcess(sidecarEntry),
    healthProbe: probeLoopbackHealth,
    loadBootstrap: async () => ({
      listenPort,
      clientPermissionsPath:join(userDataPath,"client-permissions.v1.json"),
      appVersion: app.getVersion(),
      os: runtime.os,
      arch: process.arch,
      dataPath: workspacePath,
      rendererPath,
      resourceRoot,
      embeddingModelRoot: embeddingModelManager.modelRoot,
      embeddingModelManifestPath: embeddingModelManager.manifestPath,
      credentials: await vault.readForSidecar(),
      workspaceId,
      syncEnabled: Boolean(
        workspaceCatalog.list().find((workspace) => workspace.workspaceId === workspaceId)
          ?.cloudSyncEnabled,
      ),
      syncWorkspaceKey:
        (
          await workspaceKeyVault.read(workspaceId)
        )?.toString("base64") ?? null,
    }),
    onHealthChanged: (health) => {
      if (supervisor !== instance) return;
      if (shouldLogSidecarOutput() && health.lastError) {
        const safe = health.lastError
          .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
          .replace(/[A-Fa-f0-9]{48,}/g, "[redacted]");
        writeDiagnostic(`[sidecar-health] ${health.status}: ${safe}\n`);
      }
      if (health.status === "ready" && health.baseUrl) {
        scheduleRendererHandoff(health.baseUrl);
        if (personalSyncCoordinator) {
          const active = workspaceCatalog
            .list()
            .find((workspace) => workspace.workspaceId === workspaceId);
          if (active?.cloudSyncEnabled) personalSyncCoordinator.start();
          else personalSyncCoordinator.stop();
        }
      }
      if (
        health.status === "failed" &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        void mainWindow.loadURL(recoveryDocument(health));
      }
    },
    onMessage: (message, process) => {
      void codexAuth
        .getAccessToken({ forceRefresh: message.forceRefresh === true })
        .then((accessToken) =>
          {
            try {
              process.sendMessage({
                type: "xuelearn.codex.auth.response",
                requestId: message.requestId,
                accessToken,
              });
            } catch {
              // The sidecar may have exited while the host was refreshing.
            }
          },
        )
        .catch((error) => {
          try {
            process.sendMessage({
              type: "xuelearn.codex.auth.response",
              requestId: message.requestId,
              error: error instanceof Error ? error.message : String(error),
            });
          } catch {
            // The sidecar may have exited while reporting the auth failure.
          }
        },
        );
    },
    });
    supervisors.set(workspaceId, instance);
    return instance;
  };
  supervisor = createWorkspaceSupervisor();
  let broker: Awaited<ReturnType<typeof createWorkspaceClientBroker>> | undefined;
  let pluginManager: DesktopPluginManager | undefined;
  let pluginViews: DesktopPluginViews | undefined;
  const pluginCapabilities = new DesktopHostCapabilities();
  const pluginSurfaces = new DesktopPluginSurfaces();
  let checkingQuit = false;
  let idleQuitTimer: ReturnType<typeof setTimeout> | undefined;
  const prepareQuitWhenIdle = async () => {
    if (checkingQuit || quitPrepared || bootstrapPending) return;
    checkingQuit = true;
    try {
      quitAdmissionPaused=true;
      try {
        await pluginManager?.shutdown();
      } catch {
        // An extension can keep an export alive. Retry normal shutdown after it drains.
        quitAdmissionPaused=false;
        mainWindow?.hide();
        if (!idleQuitTimer) idleQuitTimer=setTimeout(() => {
          idleQuitTimer=undefined;
          void prepareQuitWhenIdle();
        },15_000);
        return;
      }
      await broker?.suspend();
      const instances=[...supervisors.values()];
      const retained = await Promise.all(instances.map(instance => instance.prepareStop()));
      if (retained.some(canStop => !canStop)) {
        await Promise.all(instances.filter((_,index)=>retained[index]).map(instance=>instance.resumeAccepting()));
        quitAdmissionPaused=false;
        broker?.resume();
        mainWindow?.hide();
        if (!idleQuitTimer) idleQuitTimer = setTimeout(() => {
          idleQuitTimer = undefined;
          void prepareQuitWhenIdle();
        }, 15_000);
        return;
      }
      await broker?.close();
      broker=undefined;
      await pluginCapabilities.dispose();
      for (const instance of instances) instance.stop();
      quitPrepared = true;
      app.quit();
    } finally { checkingQuit = false; }
  };
  requestSafeQuit = prepareQuitWhenIdle;
  startBackgroundWorkspace = async workspaceId => {
    if (quitAdmissionPaused) throw new Error("Workspace services are preparing to quit");
    const instance = supervisors.get(workspaceId) ?? createWorkspaceSupervisor(workspaceId);
    await instance.start();
  };
  for (const workspaceId of pendingBackgroundWorkspaces) await startBackgroundWorkspace(workspaceId);
  pendingBackgroundWorkspaces.clear();
  broker = await createWorkspaceClientBroker(join(userDataPath,"client-connections"),async request => {
    await startBackgroundWorkspace!(request.workspaceId);
    const host = supervisors.get(request.workspaceId)!.getSession();
    if (!host) throw new Error("Selected workspace service is unavailable");
    const response = await fetch(`${host.baseUrl}/api/workspace-service/sessions`,{
      method:"POST",signal:AbortSignal.timeout(30_000),headers:{Authorization:`Bearer ${host.token}`,"Content-Type":"application/json"},body:JSON.stringify(request),
    });
    if(!response.ok)throw new Error(`Workspace connection grant failed (${response.status})`);
    return {endpoint:host.baseUrl,session:workspaceServiceSessionSchema.parse(await response.json())};
  },{authorizeLearningCommands:async request=>{
    const permissionsPath=join(userDataPath,"client-permissions.v1.json");
    try {
      const info=await lstat(permissionsPath);
      if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0||process.getuid && info.uid!==process.getuid())
        throw new Error("Workspace client permissions must be a private same-user file");
      const permissions=JSON.parse(await readFile(permissionsPath,"utf8")) as {version?:number;grants?:Array<{workspaceId:string;clientId:string;capabilities:string[]}>};
      if(permissions.version!==1||!Array.isArray(permissions.grants))throw new Error("Workspace client permissions are invalid");
      const grant=permissions.grants.find(grant=>grant.workspaceId===request.workspaceId && grant.clientId===request.clientId);
      return Boolean(grant && request.capabilities.every(capability=>["course.catalog.read","course.content.read","course.assets.read"].includes(capability) || grant.capabilities.includes(capability)));
    }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
  }});

  await pluginCapabilities.register('workspace.connection', 1, {
    get: async (_args, context) => {
      if (!workspaceCatalog.list().some(workspace => workspace.workspaceId === context.workspaceId)) throw Error('Unknown plugin workspace');
      await startBackgroundWorkspace!(context.workspaceId);
      return { workspaceId: context.workspaceId, brokerPath: join(userDataPath, 'client-connections') };
    },
  });
  await registerCorePluginCapabilities(pluginCapabilities, {
    getSession: async (workspaceId, signal) => {
      signal.throwIfAborted();
      if (!workspaceCatalog.list().some(workspace => workspace.workspaceId === workspaceId)) throw Error('Unknown plugin workspace');
      await startBackgroundWorkspace!(workspaceId);
      signal.throwIfAborted();
      const host = supervisors.get(workspaceId)?.getSession();
      if (!host) throw Error('Selected workspace service is unavailable');
      return host;
    },
  });
  pluginManager = new DesktopPluginManager({
    store: new DesktopPluginPackageStore(join(userDataPath, 'plugins')),
    capabilities: pluginCapabilities,
    processFactory: async config => {
      if(config.manifest.runtime?.mode !== 'host')return createElectronPluginProcess(join(__dirname, 'plugins', 'worker.js'), config);
      await validateNativePluginAbi(config,process.versions.electron!);
      const native=createPluginNativeServices({configuration:config,capabilities:pluginCapabilities,surfaces:pluginSurfaces,
        hasWorkspace:id=>workspaceCatalog.list().some(workspace=>workspace.workspaceId===id),
        getAIEnvironment:async()=>({...pluginProviderEnvironment(await vault.readForSidecar()),XUELEARN_SVG_FONT_DIR:join(resourceRoot,'local-sidecar','fonts')}),
        codexToken:input=>codexAuth.getAccessToken(input)});
      return createHostPluginProcess(config,native.services,native.dispose);
    },
    onChange: () => {
      pluginViews?.reconcile();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(PLUGIN_IPC.changed);
    },
  });
  pluginViews = new DesktopPluginViews(pluginManager, () => workspaceCatalog.activeWorkspaceId);
  installPluginViewProtocol(session.defaultSession, pluginViews, pluginSurfaces);
  removePluginIpcHandlers = registerPluginIpc({
    manager: pluginManager,
    views: pluginViews,
    getWorkspaceId: () => workspaceCatalog.activeWorkspaceId,
    isQuitting: () => quitAdmissionPaused || quitRequested,
    isTrustedSender: event => Boolean(mainWindow && !mainWindow.isDestroyed()
      && event.sender === mainWindow.webContents
      && event.senderFrame === mainWindow.webContents.mainFrame
      && [supervisor.getHealth().baseUrl, developmentRendererOrigin].some(origin => {
        try { return origin && new URL(event.senderFrame!.url).origin === new URL(origin).origin; }
        catch { return false; }
      })),
  });
  // A broken extension or registry must not prevent the learning application from starting.
  await pluginManager.restoreEnabled().catch(() => {
    if (shouldLogSidecarOutput()) writeDiagnostic('[plugins] Installed plugins need attention; open the plugin manager.\n');
  });


  const restartActiveWorkspace = async () => {
    if (!(await supervisor.prepareStop())) {
      throw new Error("The workspace service is still in use by another client or background task.");
    }
    if(quitAdmissionPaused){await supervisor.resumeAccepting();throw new Error("Workspace services are preparing to quit");}
    return supervisor.restart();
  };
  personalSyncCoordinator = new FolderPersonalSyncCoordinator(
    workspaceCatalog,
    () => supervisor.getSession(),
    app.getVersion(),
  );

  installSessionSecurity(
    session.defaultSession,
    () => supervisor.getSession(),
    {
      extraAuthOrigins: developmentRendererOrigin
        ? [developmentRendererOrigin]
        : [],
      onLocalMutationCompleted: () =>
        personalSyncCoordinator?.notifyLocalCommit(),
      beforeLeasedMutation: async (target) => {
        const active = workspaceCatalog
          .list()
          .find((workspace) => workspace.active);
        if (!active?.cloudSyncEnabled || !personalSyncCoordinator) return;
        let scope: SyncLeaseScope;
        if (target.kind === "unit") {
          const sidecar = supervisor.getSession();
          if (!sidecar) throw new Error("The local service is unavailable");
          const response = await fetch(
            `${sidecar.baseUrl}/api/local/personal-sync/transport/unit-scope?unitId=${encodeURIComponent(target.unitId)}`,
            { headers: { Authorization: `Bearer ${sidecar.token}` } },
          );
          if (!response.ok)
            throw new Error("Cannot resolve the unit's goal lease");
          const unit = (await response.json()) as { goalId?: string };
          const goalId = unit.goalId;
          if (!goalId) throw new Error("Cannot resolve the unit's goal lease");
          scope = { kind: "goal", goalId };
        } else scope = target;
        await personalSyncCoordinator.changeLease({ scope, action: "acquire" });
      },
    },
  );
  installInteractiveHtmlProtocol(session.defaultSession, htmlPlayground);
  removeIpcHandlers = registerDesktopIpc({
    runtime,
    getHealth: () => supervisor.getHealth(),
    restart: restartActiveWorkspace,
    resetDevelopmentData: async () => {
      if (app.isPackaged || process.env.XUELEARN_DESKTOP_DEV !== "1") {
        throw new Error("Development data reset is unavailable in this build");
      }
      if (!(await supervisor.prepareStop())) {
        throw new Error("The workspace service is still in use by another client or background task.");
      }
      if(quitAdmissionPaused){await supervisor.resumeAccepting();throw new Error("Workspace services are preparing to quit");}
      try {
        const active=supervisor.getSession();
        if(!active)throw new Error("Cannot prove workspace storage ownership for reset");
        const response=await fetch(`${active.baseUrl}/api/workspace-service/storage-ownership`,{signal:AbortSignal.timeout(10_000),headers:{Authorization:`Bearer ${active.token}`}});
        if(!response.ok)throw new Error("Cannot prove workspace storage ownership for reset");
        const ownership=await response.json() as {hasLegacyExtensions?:boolean;canResetData?:boolean};
        if(ownership.hasLegacyExtensions!==false || ownership.canResetData!==true)
          throw new Error("This workspace retains legacy product data. Create a verified learning-only workspace through the controlled split/import before resetting it.");
      }catch(error){await supervisor.resumeAccepting();throw error;}
      if(quitAdmissionPaused){await supervisor.resumeAccepting();throw new Error("Workspace services are preparing to quit");}
      return supervisor.restartAfter(() => {
        for (const suffix of ["", "-wal", "-shm", "-journal"]) {
          const target = join(
            workspaceCatalog.activeWorkspacePath,
            `${DESKTOP_LOCAL_DATABASE_FILENAME}${suffix}`,
          );
          if (existsSync(target)) rmSync(target);
        }
        rmSync(join(workspaceCatalog.activeWorkspacePath, "log-spool"), {
          recursive: true,
          force: true,
        });
        rmSync(join(workspaceCatalog.activeWorkspacePath, "resources"), {
          recursive: true,
          force: true,
        });
      });
    },
    vault,
    codexAuth,
    embeddingModelManager,
    afterCredentialMutation: async () => {
      await restartActiveWorkspace();
    },
    workspaceCatalog,
    afterWorkspaceSwitch: async () => {
      pluginViews?.closeAll();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(PLUGIN_IPC.changed);
      personalSyncCoordinator?.workspaceChanged();
      const previous = supervisor;
      const previousIdle=await previous.prepareStop();
      if(quitAdmissionPaused){if(previousIdle)await previous.resumeAccepting();throw new Error("Workspace services are preparing to quit");}
      if (previousIdle) previous.stop();
      supervisor = supervisors.get(workspaceCatalog.activeWorkspaceId) ?? createWorkspaceSupervisor();
      const nextHealth = await supervisor.start();
      if (nextHealth.baseUrl) scheduleRendererHandoff(nextHealth.baseUrl);
    },
    getResourceRoot: () => workspaceCatalog.activeResourceRoot,
    getUserDataPath: () => userDataPath,
    personalSyncKeys,
    personalSyncCoordinator,
    htmlPlayground,
  });

  const health = await supervisor.start();
  if (!health.baseUrl)
    throw new Error("Local service reported ready without an address");
  if (!serviceOnly && !quitRequested) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f7f7f5",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Keep the native buttons on the same 48px title-bar midline as the
    // renderer sidebar toggle (`--desktop-titlebar-height` in globals.css).
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });
  lockWindowNavigation(
    mainWindow,
    () => {
      const sidecarOrigin = supervisor.getHealth().baseUrl;
      return developmentRendererOrigin
        ? [developmentRendererOrigin, sidecarOrigin].filter(
            (origin): origin is string => Boolean(origin),
          )
        : sidecarOrigin;
    },
    (url) => shell.openExternal(url),
  );
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) pluginViews?.closeAll();
  });
  mainWindow.webContents.on('render-process-gone', () => pluginViews?.closeAll());
  mainWindow.on("focus", () => personalSyncCoordinator?.setActive(true));
  mainWindow.on("blur", () => personalSyncCoordinator?.setActive(false));
  mainWindow.on("close", event => {
    if (quitPrepared) return;
    event.preventDefault();
    mainWindow?.hide();
    personalSyncCoordinator?.setActive(false);
    quitRequested=true;
    void prepareQuitWhenIdle();
  });
  mainWindow.on("closed", () => {
    pluginViews?.closeAll();
    mainWindow = null;
  });
  await mainWindow.loadURL(developmentRendererOrigin ?? health.baseUrl);

  if (!app.isPackaged) {
    removeDevelopmentHotload = installDevelopmentHotload({
      rendererPath: developmentRendererOrigin ? undefined : rendererPath,
      sidecarBuildPath: developmentSidecarBuildPath(app.getAppPath()),
      stagedSidecarPath: developmentStagedSidecarPath(app.getAppPath()),
      reloadRenderer: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.reloadIgnoringCache();
      },
      restartSidecar: () => restartActiveWorkspace().then(() => undefined),
    });
  }
  }

}

app.setName("XueLearn");
if(!app.isPackaged && process.env.XUELEARN_DESKTOP_DATA_PATH?.trim())app.setPath("userData",resolve(process.env.XUELEARN_DESKTOP_DATA_PATH));
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  // A non-zero development exit also stops desktop-dev's renderer and sidecar
  // watchers, instead of leaving a misleading hotload session running.
  if (!app.isPackaged) {
    writeDiagnostic(
      "XueLearn is already running. Quit the other window, including a packaged 好会学 app, then retry pnpm desktop:dev.\n",
    );
  }
  app.exit(app.isPackaged || process.argv.includes("--workspace-service") ? 0 : 1);
} else {
  app.on("before-quit", event => {
    if(quitPrepared)return;
    event.preventDefault();
    quitRequested=true;
    void requestSafeQuit?.();
  });
  registerInteractiveHtmlScheme();
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--workspace-service")) {
      const workspaceId = argv.find(argument => argument.startsWith("--workspace-id="))?.slice("--workspace-id=".length);
      if (workspaceId) {
        if (startBackgroundWorkspace) void startBackgroundWorkspace(workspaceId).catch(console.error);
        else pendingBackgroundWorkspaces.add(workspaceId);
      }
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("child-process-gone", (_event, details) => {
    if (!shouldLogSidecarOutput()) return;
    if (
      details.type !== "Utility" &&
      details.name !== "XueLearn Local Service"
    ) {
      return;
    }
    writeDiagnostic(
      `[sidecar-health] child-process-gone reason=${details.reason} code=${details.exitCode} name=${details.name}\n`,
    );
  });
  app
    .whenReady()
    .then(bootstrap)
    .then(() => {bootstrapPending=false;if(quitRequested)void requestSafeQuit?.();})
    .catch((error) => {
      bootstrapPending=false;
      if(quitRequested){if(requestSafeQuit)void requestSafeQuit();else{quitPrepared=true;app.quit();}return;}
      const health: SidecarHealth = {
        status: "failed",
        instanceId: null,
        baseUrl: null,
        schemaVersion: null,
        lastError: error instanceof Error ? error.message : String(error),
      };
      mainWindow = new BrowserWindow({
        width: 760,
        height: 500,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      void mainWindow.loadURL(recoveryDocument(health));
    });
}

app.on("will-quit", () => {
  personalSyncCoordinator?.stop();
  removeDevelopmentHotload?.();
  removeDevelopmentHotload = null;
  removeIpcHandlers?.();
  removeIpcHandlers = null;
  removePluginIpcHandlers?.();
  removePluginIpcHandlers = null;
});
