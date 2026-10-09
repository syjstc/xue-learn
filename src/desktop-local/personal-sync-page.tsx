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
} from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { Button } from "@xue-learn/core/source/src/components/ui/button.tsx";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet } from "@/shared/api";
import { getDesktopBridge } from "./runtime.ts";

const labels: Record<PersonalSyncStatus["state"], string> = {
  disabled: "仅保存在本机",
  synced: "已同步",
  syncing: "正在同步",
  offline: "等待同步文件夹恢复连接",
  authentication_required: "需要重新连接同步文件夹",
  locked: "需要同步密码解锁",
  read_only: "需要升级（只读）",
  conflict: "有需要检查的同步冲突",
  error: "同步遇到问题",
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

function progressLabel(progress: PersonalSyncProgress): string {
  const count =
    progress.totalItems === null
      ? ""
      : ` ${progress.completedItems}/${progress.totalItems}`;
  switch (progress.phase) {
    case "preparing":
      return "正在检查本机与同步文件夹…";
    case "uploading":
      return progress.totalItems === 0
        ? "本机记录已是最新"
        : `正在上传学习记录${count}`;
    case "receiving":
      return progress.totalItems === 0
        ? "云端记录已是最新"
        : `正在合并云端学习记录${count}`;
    case "finalizing":
      return "正在完成同步…";
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
            个人云同步
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            把端到端加密的学习记录保存到你的 iCloud Drive。无需 Apple
            开发者账户，XueLearn 也不会获得你的 Apple 登录信息。
          </p>
        </div>
      </div>

      <div className="max-w-3xl rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">{active?.name ?? "当前工作区"}</p>
              {active?.cloudSyncEnabled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                  <Check className="size-3" aria-hidden />
                  文件夹同步已启用
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {progress.running
                ? labels.syncing
                : status
                  ? labels[status.state]
                  : "正在读取状态…"}
              {status?.lastSuccessfulSyncAt
                ? ` · 上次成功 ${new Date(status.lastSuccessfulSyncAt).toLocaleString()}`
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
              {syncing ? "同步中" : "立即同步"}
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
                {progressLabel(progress)}
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
              aria-label={progressLabel(progress)}
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
              请保持 XueLearn 和同步文件夹可用；课程较多时可能需要几分钟。
            </p>
          </div>
        ) : null}

        {!active?.cloudSyncEnabled ? (
          <div className="mt-5 space-y-6 border-t pt-5">
            <Step number={1} title="选择 iCloud Drive 位置">
              <p className="mb-3 text-sm text-muted-foreground">
                在 Finder 侧边栏打开 iCloud Drive，选择一个位置。XueLearn
                会在其中创建“XueLearn Sync”文件夹。
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen className="mr-2 size-4" aria-hidden />
                  选择文件夹
                </Button>
                {selectedFolder ? (
                  <code className="max-w-full break-all rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                    {displayedFolder}
                  </code>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    尚未选择
                  </span>
                )}
              </div>
            </Step>
            <Step number={2} title="设置同步密码">
              <Label htmlFor="sync-passphrase" className="sr-only">
                同步密码
              </Label>
              <Input
                id="sync-passphrase"
                type="password"
                autoComplete="new-password"
                placeholder="至少 12 个字符"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <p className="mt-2 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
                请把密码保存在密码管理器中。忘记密码且所有已解锁设备都丢失后，加密数据无法恢复。
              </p>
            </Step>
            <Step number={3} title="启用自动同步">
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
                启用加密文件夹同步
              </Button>
            </Step>
          </div>
        ) : active.locked ? (
          <div className="mt-5 space-y-3 border-t pt-5">
            <Label htmlFor="unlock-sync-passphrase">
              输入同步密码以解锁此工作区
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
              解锁
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
                <p className="font-medium">同步文件夹</p>
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
              停用此工作区同步
            </Button>
          </div>
        )}
      </div>

      <div className="max-w-3xl rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950">
        <div className="flex gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">避免同时编辑同一个学习目标</p>
            <p className="mt-1 text-amber-900/80">
              iCloud Drive
              会同步文件，但不提供数据库级原子锁。请让一台设备完成同步后再在另一台设备继续；检测到冲突时，XueLearn
              会保留冲突记录而不会静默覆盖。
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="font-medium">在这台设备加入已有同步工作区</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          选择另一台设备使用的同一个 iCloud Drive 位置，然后输入原同步密码。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void chooseFolder()}
          >
            <FolderOpen className="mr-2 size-4" aria-hidden />
            选择同步位置
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
            查找已有工作区
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
                  加密工作区 {workspace.workspaceId.slice(0, 8)}
                </p>
                <p className="text-xs text-muted-foreground">
                  输入密码后才会在本机解密名称
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
                {exists ? "已在本机" : "加入"}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="max-w-3xl rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="font-medium">本机工作区</h3>
        <div className="mt-3 space-y-2">
          {workspaces.map((workspace) => (
            <div
              key={workspace.workspaceId}
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div>
                <p className="text-sm font-medium">{workspace.name}</p>
                <p className="text-xs text-muted-foreground">
                  {workspace.cloudSyncEnabled ? "加密文件夹同步" : "仅本机"}
                  {workspace.locked ? " · 已锁定" : ""}
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
                  切换
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">当前</span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Input
            aria-label="新工作区名称"
            placeholder="新工作区名称"
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
            创建
          </Button>
        </div>
      </div>

      {status?.conflictCount ? (
        <p className="max-w-3xl rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          存在 {status.conflictCount}{" "}
          个需要处理的冲突。冲突版本已保留，不会静默覆盖。
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
