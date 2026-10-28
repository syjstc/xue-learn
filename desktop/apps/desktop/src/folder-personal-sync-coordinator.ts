import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  PERSONAL_SYNC_ACTIVE_POLL_MS,
  PERSONAL_SYNC_IDLE_POLL_MS,
  PERSONAL_SYNC_LEASE_HEARTBEAT_MS,
  PERSONAL_SYNC_LEASE_TTL_MS,
  PERSONAL_SYNC_UPLOAD_DEBOUNCE_MS,
  assertCanChangeSyncLease,
  personalSyncProgressSchema,
  syncWorkspaceDirectorySchema,
  workspaceIdSchema,
  type SyncLeaseAction,
  type SyncLeaseScope,
  type SyncWorkspaceDirectory,
  type PersonalSyncProgress,
} from "@xue-learn/core/runtime-contracts";
import type { CloudWorkspaceBootstrap } from "./personal-sync-keys.ts";
import type { WorkspaceCatalog } from "./workspace-catalog.ts";

type SidecarSession = { baseUrl: string; token: string };
type OutgoingCommit = {
  commitId: string;
  originDeviceId: string;
  sequence: number;
  scopeKind: "workspace" | "goal";
  scopeId: string | null;
  fencingEpoch: number | null;
  ciphertextHash: string;
  envelope: unknown;
  createdAt: string;
};
type FolderCommit = OutgoingCommit & { workspaceId: string; formatVersion: 1 };
type PublishedCommitManifest = Pick<
  OutgoingCommit,
  "commitId" | "originDeviceId" | "sequence"
>;
type LeaseRecord = {
  recordName: string;
  recordChangeTag: string;
  fields: Record<string, string | number | null>;
};

const SYNC_FOLDER_NAME = "XueLearn Sync";
const MARKER_FILE = "xuelearn-personal-sync.v1.json";
const MAX_RECORD_BYTES = 5 * 1024 * 1024;

function scopeKey(scope: SyncLeaseScope): string {
  return scope.kind === "workspace" ? "workspace" : `goal:${scope.goalId}`;
}

function leaseName(scope: SyncLeaseScope): string {
  return createHash("sha256").update(scopeKey(scope)).digest("hex");
}

function actualSyncRoot(selectedPath: string): string {
  const selected = resolve(selectedPath);
  return basename(selected) === SYNC_FOLDER_NAME
    ? selected
    : join(selected, SYNC_FOLDER_NAME);
}

async function readJson(
  path: string,
  maximumBytes = MAX_RECORD_BYTES,
): Promise<unknown> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maximumBytes)
    throw new Error("A sync record has an invalid size");
  return JSON.parse(await readFile(path, "utf8"));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function immutableJson(path: string, value: unknown): Promise<void> {
  const serialized = `${JSON.stringify(value)}\n`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== serialized)
      throw new Error("A sync record ID already exists with different content");
  }
}

export class FolderPersonalSyncCoordinator {
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private active = true;
  private stopped = true;
  private progress: PersonalSyncProgress = {
    running: false,
    phase: "idle",
    completedItems: 0,
    totalItems: null,
  };

  constructor(
    private readonly catalog: WorkspaceCatalog,
    private readonly getSession: () => SidecarSession | null,
    private readonly appVersion: string,
  ) {}

  start(): void {
    this.stopped = false;
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(
        () => void this.renewOwnedLeases().catch(() => undefined),
        PERSONAL_SYNC_LEASE_HEARTBEAT_MS,
      );
    }
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
  }

  async disableRuntime(): Promise<void> {
    this.stop();
    await this.running;
    const session = this.requireSession();
    await this.local(session, "/api/local/personal-sync/runtime/disable", {
      method: "POST",
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.schedule(0);
  }

  notifyLocalCommit(): void {
    this.schedule(PERSONAL_SYNC_UPLOAD_DEBOUNCE_MS);
  }

  workspaceChanged(): void {
    this.schedule(0);
  }

  async selectFolder(selectedPath: string): Promise<string> {
    const root = await this.ensureRoot(selectedPath);
    await this.catalog.setFolderSyncPath(this.catalog.activeWorkspaceId, root);
    return root;
  }

  prepareFolder(selectedPath: string): Promise<string> {
    return this.ensureRoot(selectedPath);
  }

  async publishWorkspaceDirectory(
    input: CloudWorkspaceBootstrap,
  ): Promise<void> {
    const root = this.requireRoot();
    const directory = join(
      root,
      "workspaces",
      input.workspaceId,
      "directory.json",
    );
    await atomicJson(directory, input);
  }

  async listFolderWorkspaces(
    selectedPath: string,
  ): Promise<SyncWorkspaceDirectory[]> {
    const root = await this.ensureRoot(selectedPath);
    const workspaceRoot = join(root, "workspaces");
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    const result: SyncWorkspaceDirectory[] = [];
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        !workspaceIdSchema.safeParse(entry.name).success
      )
        continue;
      try {
        const record = (await readJson(
          join(workspaceRoot, entry.name, "directory.json"),
          1024 * 1024,
        )) as Partial<CloudWorkspaceBootstrap>;
        if (record.workspaceId !== entry.name || record.formatVersion !== 1)
          continue;
        result.push(
          syncWorkspaceDirectorySchema.parse({
            workspaceId: entry.name,
            formatVersion: 1,
            createdAt: record.createdAt,
          }),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getFolderWorkspaceBootstrap(
    selectedPath: string,
    workspaceId: string,
  ): Promise<CloudWorkspaceBootstrap> {
    workspaceIdSchema.parse(workspaceId);
    const root = await this.ensureRoot(selectedPath);
    const record = (await readJson(
      join(root, "workspaces", workspaceId, "directory.json"),
      1024 * 1024,
    )) as CloudWorkspaceBootstrap;
    if (record.workspaceId !== workspaceId || record.formatVersion !== 1)
      throw new Error("The selected sync workspace is invalid");
    return record;
  }

  async changeLease(input: SyncLeaseAction): Promise<void> {
    const session = this.requireSession();
    const { deviceId } = await this.local<{ deviceId: string }>(
      session,
      "/api/local/personal-sync/device",
    );
    const path = this.leasePath(input.scope);
    let current: LeaseRecord | null = null;
    try {
      current = (await readJson(path, 1024 * 1024)) as LeaseRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const now = Date.now();
    const holder = String(current?.fields.holderDeviceId ?? "");
    const epoch = Number(current?.fields.fencingEpoch ?? 0);
    const heartbeatAt = Date.parse(String(current?.fields.heartbeatAt ?? ""));
    const expiresAt = Date.parse(String(current?.fields.expiresAt ?? ""));
    assertCanChangeSyncLease({
      action: input.action,
      deviceId,
      holderDeviceId: holder,
      heartbeatAtMs: heartbeatAt,
      expiresAtMs: expiresAt,
      nowMs: now,
    });
    const nextHolder =
      input.action === "release"
        ? ""
        : input.action === "request_transfer"
          ? holder
          : deviceId;
    const nextEpoch = nextHolder && nextHolder !== holder ? epoch + 1 : epoch;
    const fields = {
      scopeKey: scopeKey(input.scope),
      holderDeviceId: nextHolder,
      fencingEpoch: nextEpoch,
      heartbeatAt: new Date(now).toISOString(),
      expiresAt: new Date(
        input.action === "release" ? now : now + PERSONAL_SYNC_LEASE_TTL_MS,
      ).toISOString(),
      transferRequestedByDeviceId:
        input.action === "request_transfer" ? deviceId : "",
    };
    const next: LeaseRecord = {
      recordName: leaseName(input.scope),
      recordChangeTag: randomUUID(),
      fields,
    };
    await atomicJson(path, next);
    await this.cacheLease(session, next);
  }

  syncNow(): Promise<void> {
    if (this.running) return this.running;
    this.setProgress("preparing", 0, null);
    this.running = this.performSync().finally(() => {
      this.progress = {
        running: false,
        phase: "idle",
        completedItems: 0,
        totalItems: null,
      };
      this.running = null;
      if (!this.stopped)
        this.schedule(
          this.active
            ? PERSONAL_SYNC_ACTIVE_POLL_MS
            : PERSONAL_SYNC_IDLE_POLL_MS,
        );
    });
    return this.running;
  }

  getProgress(): PersonalSyncProgress {
    return personalSyncProgressSchema.parse({ ...this.progress });
  }

  private setProgress(
    phase: Exclude<PersonalSyncProgress["phase"], "idle">,
    completedItems: number,
    totalItems: number | null,
  ): void {
    this.progress = { running: true, phase, completedItems, totalItems };
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, delay);
  }

  private async performSync(): Promise<void> {
    const session = this.getSession();
    if (!session) return;
    try {
      const root = this.requireRoot();
      await this.ensureRoot(root);
      const workspaceId = this.catalog.activeWorkspaceId;
      const workspaceRoot = join(root, "workspaces", workspaceId);
      const localDevice = await this.local<{ deviceId: string }>(
        session,
        "/api/local/personal-sync/device",
      );
      const lastSeenAt = new Date().toISOString();
      const device = {
        deviceId: localDevice.deviceId,
        appVersion: this.appVersion,
        lastSeenAt,
        acknowledgedFrontier: {},
      };
      await atomicJson(
        join(workspaceRoot, "devices", `${localDevice.deviceId}.json`),
        device,
      );
      await this.local(session, "/api/local/personal-sync/transport/device", {
        method: "POST",
        body: JSON.stringify(device),
      });

      const folderWasEmpty = !(await this.hasFolderCommits(workspaceRoot));
      let acquiredInitialLease = false;
      if (folderWasEmpty) {
        await this.changeLease({
          scope: { kind: "workspace" },
          action: "acquire",
        });
        acquiredInitialLease = true;
        await this.local<{
          created: boolean;
          totalRows: number;
          commitCount: number;
        }>(session, "/api/local/personal-sync/initial-snapshot", {
          method: "POST",
        });
      }

      const pending = await this.local<{ pendingUploadCount: number }>(
        session,
        "/api/local/personal-sync/status",
      );
      const published = await this.local<PublishedCommitManifest[]>(
        session,
        "/api/local/personal-sync/transport/published",
      );
      const missingPublished: PublishedCommitManifest[] = [];
      for (const commit of published) {
        const name = `${String(commit.sequence).padStart(12, "0")}-${commit.commitId}.json`;
        if (
          !(await isFile(
            join(workspaceRoot, "commits", commit.originDeviceId, name),
          ))
        ) {
          missingPublished.push(commit);
        }
      }
      const totalOutgoing =
        pending.pendingUploadCount + missingPublished.length;
      let uploaded = 0;
      this.setProgress("uploading", uploaded, totalOutgoing);
      for (let offset = 0; offset < missingPublished.length; offset += 200) {
        const requested = missingPublished.slice(offset, offset + 200);
        const recovered = await this.local<OutgoingCommit[]>(
          session,
          "/api/local/personal-sync/transport/published/recover",
          {
            method: "POST",
            body: JSON.stringify({
              commitIds: requested.map((commit) => commit.commitId),
            }),
          },
        );
        if (recovered.length !== requested.length)
          throw new Error(
            "A deleted synchronized record could not be recovered locally",
          );
        for (const commit of recovered) {
          const record: FolderCommit = {
            formatVersion: 1,
            workspaceId,
            ...commit,
          };
          const name = `${String(commit.sequence).padStart(12, "0")}-${commit.commitId}.json`;
          await immutableJson(
            join(workspaceRoot, "commits", commit.originDeviceId, name),
            record,
          );
          uploaded += 1;
          this.setProgress("uploading", uploaded, totalOutgoing);
        }
      }
      for (;;) {
        const outgoing = await this.local<OutgoingCommit[]>(
          session,
          "/api/local/personal-sync/now?limit=200",
          { method: "POST" },
        );
        if (!outgoing.length) break;
        for (const commit of outgoing) {
          if (commit.fencingEpoch != null) {
            const scope: SyncLeaseScope =
              commit.scopeKind === "goal" && commit.scopeId
                ? { kind: "goal", goalId: commit.scopeId }
                : { kind: "workspace" };
            const lease = (await readJson(
              this.leasePath(scope),
              1024 * 1024,
            )) as LeaseRecord;
            if (
              lease.fields.holderDeviceId !== localDevice.deviceId ||
              Number(lease.fields.fencingEpoch) !== commit.fencingEpoch ||
              Date.parse(String(lease.fields.expiresAt)) <= Date.now()
            ) {
              await this.local(
                session,
                "/api/local/personal-sync/transport/quarantine",
                {
                  method: "POST",
                  body: JSON.stringify({ commitId: commit.commitId }),
                },
              );
              uploaded += 1;
              this.setProgress("uploading", uploaded, totalOutgoing);
              continue;
            }
          }
          const record: FolderCommit = {
            formatVersion: 1,
            workspaceId,
            ...commit,
          };
          const name = `${String(commit.sequence).padStart(12, "0")}-${commit.commitId}.json`;
          const path = join(
            workspaceRoot,
            "commits",
            commit.originDeviceId,
            name,
          );
          await immutableJson(path, record);
          await this.local(
            session,
            "/api/local/personal-sync/transport/acknowledge",
            {
              method: "POST",
              body: JSON.stringify({
                commitId: commit.commitId,
                remoteRecordName: join(commit.originDeviceId, name),
              }),
            },
          );
          uploaded += 1;
          this.setProgress("uploading", uploaded, totalOutgoing);
        }
      }

      await this.cacheFolderDevices(session, workspaceRoot);
      await this.applyFolderCommits(session, workspaceRoot, workspaceId);
      this.setProgress("finalizing", 0, null);
      await this.local(session, "/api/local/personal-sync/transport/cursor", {
        method: "POST",
        body: JSON.stringify({ syncToken: new Date().toISOString() }),
      });
      if (acquiredInitialLease) {
        await this.changeLease({
          scope: { kind: "workspace" },
          action: "release",
        });
      }
      await this.report(session, "clear");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = /ENOENT|EACCES|EPERM|offline|unavailable/i.test(message)
        ? "offline"
        : "error";
      await this.report(session, kind, message).catch(() => undefined);
    }
  }

  private async hasFolderCommits(workspaceRoot: string): Promise<boolean> {
    try {
      const origins = await readdir(join(workspaceRoot, "commits"), {
        withFileTypes: true,
      });
      for (const origin of origins) {
        if (!origin.isDirectory()) continue;
        const files = await readdir(
          join(workspaceRoot, "commits", origin.name),
          { withFileTypes: true },
        );
        if (
          files.some(
            (file) =>
              file.isFile() && /^\d{12}-[0-9a-f-]{36}\.json$/i.test(file.name),
          )
        )
          return true;
      }
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async cacheFolderDevices(
    session: SidecarSession,
    workspaceRoot: string,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(join(workspaceRoot, "devices"), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const device = await readJson(
        join(workspaceRoot, "devices", entry.name),
        1024 * 1024,
      );
      await this.local(session, "/api/local/personal-sync/transport/device", {
        method: "POST",
        body: JSON.stringify(device),
      });
    }
  }

  private async applyFolderCommits(
    session: SidecarSession,
    workspaceRoot: string,
    workspaceId: string,
  ): Promise<void> {
    const frontier = await this.local<Record<string, number>>(
      session,
      "/api/local/personal-sync/transport/frontier",
    );
    const records: FolderCommit[] = [];
    let origins;
    try {
      origins = await readdir(join(workspaceRoot, "commits"), {
        withFileTypes: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const origin of origins) {
      if (!origin.isDirectory()) continue;
      const folder = join(workspaceRoot, "commits", origin.name);
      const files = await readdir(folder, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !/^\d{12}-[0-9a-f-]{36}\.json$/i.test(file.name))
          continue;
        const record = (await readJson(
          join(folder, file.name),
        )) as FolderCommit;
        if (record.formatVersion !== 1 || record.workspaceId !== workspaceId)
          throw new Error("A folder sync record belongs to another workspace");
        if (record.sequence > Number(frontier[record.originDeviceId] ?? 0)) {
          records.push(record);
        }
      }
    }
    records.sort(
      (a, b) =>
        a.sequence - b.sequence ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.commitId.localeCompare(b.commitId),
    );
    this.setProgress("receiving", 0, records.length);
    const applied = new Set<string>();
    let pending = records.map((record) => ({ record, error: "" }));
    for (let pass = 0; pass < records.length && pending.length; pass += 1) {
      const retry: Array<{ record: FolderCommit; error: string }> = [];
      let progressed = false;
      for (const item of pending) {
        const { record } = item;
        try {
          await this.local(
            session,
            "/api/local/personal-sync/transport/apply",
            {
              method: "POST",
              body: JSON.stringify({
                commitId: record.commitId,
                ciphertextHash: record.ciphertextHash,
                envelope: record.envelope,
              }),
            },
          );
          applied.add(record.commitId);
          this.setProgress("receiving", applied.size, records.length);
          progressed = true;
        } catch (error) {
          retry.push({
            record,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      pending = retry;
      if (!progressed) break;
    }
    if (pending.length)
      throw new Error(
        `Could not apply ${pending.length} synchronized commit${pending.length === 1 ? "" : "s"}: ${pending[0]!.error}`,
      );
  }

  private async ensureRoot(selectedPath: string): Promise<string> {
    const root = actualSyncRoot(selectedPath);
    await mkdir(join(root, "workspaces"), { recursive: true, mode: 0o700 });
    const marker = join(root, MARKER_FILE);
    try {
      const value = (await readJson(marker, 1024 * 1024)) as {
        formatVersion?: number;
      };
      if (value.formatVersion !== 1)
        throw new Error(
          "This folder uses an incompatible XueLearn sync format",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await immutableJson(marker, {
        formatVersion: 1,
        kind: "xuelearn-personal-sync",
        createdAt: new Date().toISOString(),
      });
    }
    return root;
  }

  private requireRoot(): string {
    const active = this.catalog.list().find((workspace) => workspace.active);
    if (!active?.syncFolderPath)
      throw new Error("Choose an iCloud Drive sync folder first");
    return resolve(active.syncFolderPath);
  }

  private leasePath(scope: SyncLeaseScope): string {
    return join(
      this.requireRoot(),
      "workspaces",
      this.catalog.activeWorkspaceId,
      "leases",
      `${leaseName(scope)}.json`,
    );
  }

  private requireSession(): SidecarSession {
    const session = this.getSession();
    if (!session) throw new Error("The local workspace service is unavailable");
    return session;
  }

  private async cacheLease(
    session: SidecarSession,
    lease: LeaseRecord,
  ): Promise<void> {
    const serverModifiedAt = String(lease.fields.heartbeatAt);
    await this.local(session, "/api/local/personal-sync/transport/lease", {
      method: "POST",
      body: JSON.stringify({
        scopeKey: String(lease.fields.scopeKey),
        holderDeviceId: String(lease.fields.holderDeviceId ?? ""),
        fencingEpoch: Number(lease.fields.fencingEpoch ?? 0),
        serverModifiedAt,
        expiresAt: String(lease.fields.expiresAt ?? serverModifiedAt),
        recordChangeTag: lease.recordChangeTag,
        transferRequestedByDeviceId:
          lease.fields.transferRequestedByDeviceId || null,
      }),
    });
  }

  private async renewOwnedLeases(): Promise<void> {
    const session = this.getSession();
    if (!session || this.stopped) return;
    const [{ deviceId }, leases] = await Promise.all([
      this.local<{ deviceId: string }>(
        session,
        "/api/local/personal-sync/device",
      ),
      this.local<
        Array<{ scopeKey: string; holderDeviceId: string; expiresAt: string }>
      >(session, "/api/local/personal-sync/leases"),
    ]);
    for (const lease of leases) {
      if (
        lease.holderDeviceId !== deviceId ||
        Date.parse(lease.expiresAt) <= Date.now()
      )
        continue;
      const scope: SyncLeaseScope =
        lease.scopeKey === "workspace"
          ? { kind: "workspace" }
          : { kind: "goal", goalId: lease.scopeKey.slice("goal:".length) };
      await this.changeLease({ scope, action: "renew" });
    }
  }

  private async report(
    session: SidecarSession,
    kind: "offline" | "error" | "clear",
    message?: string,
  ): Promise<void> {
    await this.local(session, "/api/local/personal-sync/transport/state", {
      method: "POST",
      body: JSON.stringify({ kind, message: message ?? null }),
    });
  }

  private async local<T = void>(
    session: SidecarSession,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${session.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const body = await response.text();
    if (!response.ok)
      throw new Error(body || `Local sync request failed (${response.status})`);
    return (body ? JSON.parse(body) : undefined) as T;
  }
}
