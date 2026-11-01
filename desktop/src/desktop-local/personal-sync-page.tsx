import {
  useT,
  getCurrentUiLocale,
  countVariant,
  type TranslationKey,
} from "@xue-learn/core/i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  Cloud,
  FolderOpen,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type {
  PersonalSyncStatus,
  PersonalSyncProgress,
  WorkspaceSummary,
  SyncWorkspaceDirectory,
} from "@xue-learn/core/runtime-contracts";
import { Button } from "@xue-learn/core/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet } from "@/shared/api";
import { getDesktopBridge } from "./runtime.ts";

const labels: Record<PersonalSyncStatus["state"], TranslationKey> = {
  disabled: "desktop.sync.state.disabled",
  synced: "desktop.sync.state.synced",
  syncing: "desktop.sync.state.syncing",
  offline: "desktop.sync.state.offline",
  authentication_required: "desktop.sync.state.authenticationRequired",
  locked: "desktop.sync.state.locked",
  read_only: "desktop.sync.state.readOnly",
  conflict: "desktop.sync.state.conflict",
  error: "desktop.sync.state.error",
};

const idleProgress: PersonalSyncProgress = {
  running: false,
  phase: "idle",
  completedItems: 0,
  totalItems: null,
};

export async function settlePersonalSyncAction(input: {
  action: () => Promise<unknown>;
  refresh: () => Promise<void>;
  refreshDuringRuntimeRestart: () => Promise<void>;
  runtimeRestartExpected?: boolean;
}): Promise<void> {
  await input.action();
  await (input.runtimeRestartExpected
    ? input.refreshDuringRuntimeRestart()
    : input.refresh());
}

function progressLabel(
  progress: PersonalSyncProgress,
  t: ReturnType<typeof useT>,
): string {
  const count =
    progress.totalItems === null
      ? ""
      : ` ${progress.completedItems}/${progress.totalItems}`;
  switch (progress.phase) {
    case "preparing":
      return t("desktop.sync.progress.preparing");
    case "uploading":
      return progress.totalItems === 0
        ? t("desktop.sync.progress.localUpToDate")
        : t("desktop.sync.progress.uploading", { count });
    case "receiving":
      return progress.totalItems === 0
        ? t("desktop.sync.progress.remoteUpToDate")
        : t("desktop.sync.progress.receiving", { count });
    case "finalizing":
      return t("desktop.sync.progress.finalizing");
    case "idle":
      return "";
  }
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-100)] text-sm font-semibold text-[var(--brand-800)]">
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

export function PersonalSyncPage() {
  const t = useT();
  const bridge = useMemo(() => getDesktopBridge(), []);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [status, setStatus] = useState<PersonalSyncStatus>();
  const [progress, setProgress] = useState<PersonalSyncProgress>(idleProgress);
  const [passphrase, setPassphrase] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [newName, setNewName] = useState("");
  const [folderWorkspaces, setFolderWorkspaces] = useState<
    SyncWorkspaceDirectory[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const [nextWorkspaces, nextStatus] = await Promise.all([
      bridge.workspaces.list(),
      apiGet<PersonalSyncStatus>("/api/local/personal-sync/status"),
    ]);
    setWorkspaces(nextWorkspaces);
    setStatus(nextStatus);
    const active = nextWorkspaces.find((workspace) => workspace.active);
    if (active?.syncFolderPath) setSelectedFolder(active.syncFolderPath);
  }, [bridge]);

  const refreshDuringRuntimeRestart = useCallback(async () => {
    // Enabling and unlocking sync restart the sidecar after the IPC action
    // resolves. Only read Electron-owned state here so a successful mutation
    // is not reported as a server error during that planned restart.
    const nextWorkspaces = await bridge.workspaces.list();
    setWorkspaces(nextWorkspaces);
    setStatus(undefined);
    const nextActive = nextWorkspaces.find((workspace) => workspace.active);
    if (nextActive?.syncFolderPath)
      setSelectedFolder(nextActive.syncFolderPath);
  }, [bridge]);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
    const timer = window.setInterval(
      () => void refresh().catch(() => undefined),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const getProgress = bridge.personalSync.getProgress;
    if (typeof getProgress !== "function") return;
    const readProgress = () => {
      void Promise.resolve()
        .then(() => getProgress.call(bridge.personalSync))
        .then(setProgress)
        .catch(() => undefined);
    };
    readProgress();
    const timer = window.setInterval(readProgress, 750);
    return () => window.clearInterval(timer);
  }, [bridge]);

  const run = async (
    action: () => Promise<unknown>,
    options: { runtimeRestartExpected?: boolean } = {},
  ) => {
    setBusy(true);
    setError(undefined);
    try {
      await settlePersonalSyncAction({
        action,
        refresh,
        refreshDuringRuntimeRestart,
        runtimeRestartExpected: options.runtimeRestartExpected,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    const picked = await bridge.dialog.pickDirectory();
    if (!picked) return;
    setSelectedFolder(picked.path);
    setFolderWorkspaces([]);
  };

  const active = workspaces.find((workspace) => workspace.active);
  const passphraseReady = [...passphrase].length >= 12;
  const displayedFolder = selectedFolder.endsWith("XueLearn Sync")
    ? selectedFolder
    : `${selectedFolder}/XueLearn Sync`;
  const syncing = busy || progress.running;
  const progressPercent =
    progress.totalItems && progress.totalItems > 0
      ? Math.round((progress.completedItems / progress.totalItems) * 100)
      : null;

  return (
    <section className="space-y-5" aria-labelledby="personal-sync-title">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-[var(--brand-50)] p-2.5 text-[var(--brand-700)]">
          <Cloud className="size-5" aria-hidden />
        </span>
        <div>
          <h2 id="personal-sync-title" className="text-xl font-semibold">
            {t("desktop.deviceSettings.personalSync")}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t(
              "desktop.ui.personalSyncPage.saveEndToEndEncryptedLearningRecords",
            )}
          </p>
        </div>
      </div>

      <div className="max-w-3xl rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">
                {active?.name ??
                  t("desktop.ui.personalSyncPage.currentWorkspace")}
              </p>
              {active?.cloudSyncEnabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                  <Check className="size-3" aria-hidden />
                  {t("desktop.ui.personalSyncPage.folderSyncEnabled")}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {progress.running
                ? labels.syncing
                : status
                  ? t(labels[status.state])
                  : t("desktop.ui.personalSyncPage.checkingStatus")}
              {status?.lastSuccessfulSyncAt
                ? t("desktop.sync.lastSuccess", {
                    time: new Date(status.lastSuccessfulSyncAt).toLocaleString(
                      getCurrentUiLocale(),
                    ),
                  })
                : ""}
            </p>
          </div>
          {active?.cloudSyncEnabled ? (
            <Button
              disabled={syncing || active.locked}
              onClick={() => void run(() => bridge.personalSync.syncNow())}
            >
              <RefreshCw
                className={`mr-2 size-4 ${syncing ? "animate-spin" : ""}`}
                aria-hidden
              />
              {syncing
                ? t("desktop.ui.personalSyncPage.syncing")
                : t("desktop.ui.personalSyncPage.syncNow")}
            </Button>
          ) : null}
        </div>

        {progress.running ? (
          <div
            className="mt-4 rounded-xl bg-[var(--brand-50)] px-3.5 py-3"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-[var(--brand-900)]">
                {progressLabel(progress, t)}
              </span>
              {progressPercent !== null ? (
                <span className="tabular-nums text-[var(--brand-700)]">
                  {progressPercent}%
                </span>
              ) : null}
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--brand-200)]"
              role="progressbar"
              aria-label={progressLabel(progress, t)}
              aria-valuemin={0}
              aria-valuemax={progress.totalItems ?? undefined}
              aria-valuenow={
                progress.totalItems === null
                  ? undefined
                  : progress.completedItems
              }
            >
              <div
                className={`h-full rounded-full bg-[var(--brand-600)] transition-[width] duration-300 ${
                  progressPercent === null ? "w-1/3 animate-pulse" : ""
                }`}
                style={
                  progressPercent === null
                    ? undefined
                    : { width: `${progressPercent}%` }
                }
              />
            </div>
            <p className="mt-2 text-xs text-[var(--brand-800)]/75">
              {t(
                "desktop.ui.personalSyncPage.keepXuelearnAndTheSyncFolderAvailable",
              )}
            </p>
          </div>
        ) : null}

        {!active?.cloudSyncEnabled ? (
          <div className="mt-5 space-y-6 border-t pt-5">
            <Step
              number={1}
              title={t(
                "desktop.ui.personalSyncPage.chooseAnIcloudDriveLocation",
              )}
            >
              <p className="mb-3 text-sm text-muted-foreground">
                {t(
                  "desktop.ui.personalSyncPage.openIcloudDriveInFinderAndChoose",
                )}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen className="mr-2 size-4" aria-hidden />
                  {t("desktop.ui.personalSyncPage.chooseFolder")}
                </Button>
                {selectedFolder ? (
                  <code className="max-w-full break-all rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                    {displayedFolder}
                  </code>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("desktop.ui.personalSyncPage.notSelected")}
                  </span>
                )}
              </div>
            </Step>
            <Step
              number={2}
              title={t("desktop.ui.personalSyncPage.setASyncPassword")}
            >
              <Label htmlFor="sync-passphrase" className="sr-only">
                {t("desktop.ui.personalSyncPage.syncPassword")}
              </Label>
              <Input
                id="sync-passphrase"
                type="password"
                autoComplete="new-password"
                placeholder={t(
                  "desktop.ui.personalSyncPage.atLeast12Characters",
                )}
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <p className="mt-2 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t(
                  "desktop.ui.personalSyncPage.keepThisPasswordInAPasswordManager",
                )}
              </p>
            </Step>
            <Step
              number={3}
              title={t("desktop.ui.personalSyncPage.enableAutomaticSync")}
            >
              <Button
                disabled={busy || !selectedFolder || !passphraseReady}
                onClick={() =>
                  void run(
                    () =>
                      bridge.personalSync.connect({
                        folderPath: selectedFolder,
                        passphrase,
                      }),
                    { runtimeRestartExpected: true },
                  )
                }
              >
                <ShieldCheck className="mr-2 size-4" aria-hidden />
                {t("desktop.ui.personalSyncPage.enableEncryptedFolderSync")}
              </Button>
            </Step>
          </div>
        ) : active.locked ? (
          <div className="mt-5 space-y-3 border-t pt-5">
            <Label htmlFor="unlock-sync-passphrase">
              {t(
                "desktop.ui.personalSyncPage.enterTheSyncPasswordToUnlockThis",
              )}
            </Label>
            <Input
              id="unlock-sync-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <Button
              disabled={busy || !passphraseReady}
              onClick={() =>
                void run(() => bridge.personalSync.unlock({ passphrase }), {
                  runtimeRestartExpected: true,
                })
              }
            >
              {t("desktop.ui.personalSyncPage.unlock")}
            </Button>
          </div>
        ) : (
          <div className="mt-5 space-y-3 border-t pt-5">
            <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm">
              <FolderOpen
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="font-medium">
                  {t("desktop.ui.personalSyncPage.syncFolder")}
                </p>
                <code className="mt-1 block break-all text-xs text-muted-foreground">
                  {active.syncFolderPath}
                </code>
              </div>
            </div>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => bridge.personalSync.disconnect())}
            >
              {t("desktop.ui.personalSyncPage.disableSyncForThisWorkspace")}
            </Button>
          </div>
        )}
      </div>

      <div className="max-w-3xl rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
        <div className="flex gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              {t("desktop.ui.personalSyncPage.avoidEditingTheSameGoalOnTwo")}
            </p>
            <p className="mt-1 text-amber-900/80">
              {t(
                "desktop.ui.personalSyncPage.letOneDeviceFinishSyncingBeforeContinuing",
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="font-medium">
          {t("desktop.ui.personalSyncPage.connectAnExistingSyncedWorkspace")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("desktop.ui.personalSyncPage.chooseTheSameIcloudDriveLocationAs")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void chooseFolder()}
          >
            <FolderOpen className="mr-2 size-4" aria-hidden />
            {t("desktop.ui.personalSyncPage.chooseSyncLocation")}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !selectedFolder}
            onClick={() =>
              void run(async () =>
                setFolderWorkspaces(
                  await bridge.personalSync.listFolderWorkspaces({
                    folderPath: selectedFolder,
                  }),
                ),
              )
            }
          >
            {t("desktop.ui.personalSyncPage.findExistingWorkspaces")}
          </Button>
        </div>
        {folderWorkspaces.map((workspace) => {
          const exists = workspaces.some(
            (local) => local.workspaceId === workspace.workspaceId,
          );
          return (
            <div
              key={workspace.workspaceId}
              className="mt-3 flex items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {t("desktop.ui.personalSyncPage.encryptedWorkspace")}
                  {workspace.workspaceId.slice(0, 8)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "desktop.ui.personalSyncPage.enterThePasswordToDecryptItsName",
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || exists || !passphraseReady}
                onClick={() =>
                  void run(() =>
                    bridge.personalSync.joinWorkspace({
                      workspaceId: workspace.workspaceId,
                      folderPath: selectedFolder,
                      passphrase,
                    }),
                  )
                }
              >
                {exists
                  ? t("desktop.ui.personalSyncPage.alreadyOnThisDevice")
                  : t("desktop.ui.personalSyncPage.connect")}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="max-w-3xl rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="font-medium">
          {t("desktop.ui.personalSyncPage.workspacesOnThisDevice")}
        </h3>
        <div className="mt-3 space-y-2">
          {workspaces.map((workspace) => (
            <div
              key={workspace.workspaceId}
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div>
                <p className="text-sm font-medium">{workspace.name}</p>
                <p className="text-xs text-muted-foreground">
                  {workspace.cloudSyncEnabled
                    ? t("desktop.ui.personalSyncPage.encryptedFolderSync")
                    : t("desktop.ui.personalSyncPage.thisDeviceOnly")}
                  {workspace.locked
                    ? t("desktop.ui.personalSyncPage.locked")
                    : ""}
                </p>
              </div>
              {!workspace.active ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      bridge.workspaces.switch({
                        workspaceId: workspace.workspaceId,
                      }),
                    )
                  }
                >
                  {t("desktop.ui.personalSyncPage.switch")}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("desktop.ui.personalSyncPage.current")}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Input
            aria-label={t("desktop.ui.personalSyncPage.newWorkspaceName")}
            placeholder={t("desktop.ui.personalSyncPage.newWorkspaceName")}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || !newName.trim()}
            onClick={() =>
              void run(async () => {
                await bridge.workspaces.create({ name: newName.trim() });
                setNewName("");
              })
            }
          >
            {t("spaces.create")}
          </Button>
        </div>
      </div>

      {status?.conflictCount ? (
        <p className="max-w-3xl rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          {t(`desktop.sync.conflicts.${countVariant(status.conflictCount)}`, {
            count: status.conflictCount,
          })}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="max-w-3xl rounded-xl bg-destructive/10 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
