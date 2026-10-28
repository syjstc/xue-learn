import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  DESKTOP_LOCAL_DATABASE_FILENAME,
  workspaceIdSchema,
  type WorkspaceSummary,
} from "@xue-learn/core/runtime-contracts";
import { z } from "zod";

const CATALOG_FILENAME = "workspace-catalog.v1.json";
const WORKSPACES_DIRECTORY = "workspaces";

const catalogWorkspaceSchema = z.object({
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(120),
  cloudSyncEnabled: z.boolean(),
  syncTransport: z.enum(["folder", "cloudkit"]).nullable().optional(),
  syncFolderPath: z.string().min(1).nullable().optional(),
  createdAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime(),
});
type CatalogWorkspace = z.infer<typeof catalogWorkspaceSchema>;

const workspaceCatalogSchema = z.object({
  version: z.literal(1),
  activeWorkspaceId: workspaceIdSchema,
  workspaces: z.array(catalogWorkspaceSchema).min(1),
});
type WorkspaceCatalogDocument = z.infer<typeof workspaceCatalogSchema>;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class WorkspaceCatalog {
  private constructor(
    private readonly userDataPath: string,
    private document: WorkspaceCatalogDocument,
  ) {}

  static async open(userDataPath: string): Promise<WorkspaceCatalog> {
    const root = resolve(userDataPath);
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (await exists(join(root, ".workspace-catalog.import.lock"))) throw new Error("WORKSPACE_IMPORT_IN_PROGRESS: Finish the controlled workspace registration before opening Electron");
    const path = join(root, CATALOG_FILENAME);
    try {
      const document = workspaceCatalogSchema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
      const catalog = new WorkspaceCatalog(root, document);
      const migratedLegacyCloudKit = document.workspaces.some((workspace) => {
        if (!workspace.cloudSyncEnabled || workspace.syncFolderPath)
          return false;
        workspace.cloudSyncEnabled = false;
        workspace.syncTransport = null;
        workspace.syncFolderPath = null;
        return true;
      });
      await catalog.ensureWorkspaceDirectories();
      if (migratedLegacyCloudKit) await catalog.persist();
      return catalog;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    // A missing catalog is not permission to rename or probe an existing library.
    // The controlled split/import flow validates a read-only backup first.
    if (await exists(join(root, DESKTOP_LOCAL_DATABASE_FILENAME)) || await exists(join(root, "xuelearn-local.sqlite3"))) {
      throw new Error("LEGACY_WORKSPACE_IMPORT_REQUIRED: Existing root learning data is preserved in place. Create a verified learning-only split from a read-only backup, then explicitly register it as a new workspace before restarting");
    }
    const now = new Date().toISOString();
    const workspaceId = randomUUID();
    const catalog = new WorkspaceCatalog(root, {
      version: 1,
      activeWorkspaceId: workspaceId,
      workspaces: [
        {
          workspaceId,
          name: "My learning workspace",
          cloudSyncEnabled: false,
          createdAt: now,
          lastOpenedAt: now,
        },
      ],
    });
    await catalog.ensureWorkspaceDirectories();
    await catalog.persist();
    return catalog;
  }

  get activeWorkspaceId(): string {
    return this.document.activeWorkspaceId;
  }

  get activeWorkspacePath(): string {
    return this.workspacePath(this.activeWorkspaceId);
  }

  get activeResourceRoot(): string {
    return join(this.activeWorkspacePath, "resources", "objects");
  }

  list(
    lockedWorkspaceIds: ReadonlySet<string> = new Set(),
  ): WorkspaceSummary[] {
    return this.document.workspaces.map((workspace) => ({
      ...workspace,
      active: workspace.workspaceId === this.document.activeWorkspaceId,
      locked: lockedWorkspaceIds.has(workspace.workspaceId),
    }));
  }

  async create(name: string): Promise<WorkspaceSummary> {
    const normalized = name.trim();
    if (!normalized || [...normalized].length > 120)
      throw new Error("Workspace name must contain 1-120 characters");
    const now = new Date().toISOString();
    const workspace: CatalogWorkspace = {
      workspaceId: randomUUID(),
      name: normalized,
      cloudSyncEnabled: false,
      syncTransport: null,
      syncFolderPath: null,
      createdAt: now,
      lastOpenedAt: now,
    };
    this.document.workspaces.push(workspace);
    await mkdir(this.workspacePath(workspace.workspaceId), {
      recursive: true,
      mode: 0o700,
    });
    await this.persist();
    return { ...workspace, active: false, locked: false };
  }

  async createJoined(
    workspaceId: string,
    name: string,
  ): Promise<WorkspaceSummary> {
    workspaceIdSchema.parse(workspaceId);
    if (
      this.document.workspaces.some((item) => item.workspaceId === workspaceId)
    )
      throw new Error("This cloud workspace already exists on this device");
    const normalized = name.trim();
    if (!normalized || [...normalized].length > 120)
      throw new Error("Workspace name must contain 1-120 characters");
    const now = new Date().toISOString();
    const workspace: CatalogWorkspace = {
      workspaceId,
      name: normalized,
      cloudSyncEnabled: true,
      syncTransport: "folder",
      syncFolderPath: null,
      createdAt: now,
      lastOpenedAt: now,
    };
    this.document.workspaces.push(workspace);
    await mkdir(this.workspacePath(workspaceId), {
      recursive: true,
      mode: 0o700,
    });
    await this.persist();
    return { ...workspace, active: false, locked: true };
  }

  async switchTo(workspaceId: string): Promise<WorkspaceSummary> {
    workspaceIdSchema.parse(workspaceId);
    const workspace = this.document.workspaces.find(
      (candidate) => candidate.workspaceId === workspaceId,
    );
    if (!workspace) throw new Error("Unknown local workspace");
    workspace.lastOpenedAt = new Date().toISOString();
    this.document.activeWorkspaceId = workspaceId;
    await mkdir(this.workspacePath(workspaceId), {
      recursive: true,
      mode: 0o700,
    });
    await this.persist();
    return { ...workspace, active: true, locked: false };
  }

  async setCloudSyncEnabled(
    workspaceId: string,
    enabled: boolean,
  ): Promise<void> {
    const workspace = this.document.workspaces.find(
      (candidate) => candidate.workspaceId === workspaceId,
    );
    if (!workspace) throw new Error("Unknown local workspace");
    workspace.cloudSyncEnabled = enabled;
    if (!enabled) {
      workspace.syncTransport = null;
      workspace.syncFolderPath = null;
    }
    await this.persist();
  }

  async setFolderSyncPath(workspaceId: string, path: string): Promise<void> {
    const workspace = this.document.workspaces.find(
      (candidate) => candidate.workspaceId === workspaceId,
    );
    if (!workspace) throw new Error("Unknown local workspace");
    workspace.syncTransport = "folder";
    workspace.syncFolderPath = resolve(path);
    await this.persist();
  }

  workspacePath(workspaceId: string): string {
    workspaceIdSchema.parse(workspaceId);
    const root = resolve(this.userDataPath, WORKSPACES_DIRECTORY);
    const target = resolve(root, workspaceId);
    if (!target.startsWith(`${root}${sep}`))
      throw new Error("Workspace path escapes its storage root");
    return target;
  }

  private async ensureWorkspaceDirectories(): Promise<void> {
    for (const workspace of this.document.workspaces) {
      await mkdir(this.workspacePath(workspace.workspaceId), {
        recursive: true,
        mode: 0o700,
      });
    }
  }

  private async persist(): Promise<void> {
    if (await exists(join(this.userDataPath, ".workspace-catalog.import.lock"))) throw new Error("WORKSPACE_IMPORT_IN_PROGRESS: Finish controlled registration before modifying workspace selection");
    const parsed = workspaceCatalogSchema.parse(this.document);
    const path = join(this.userDataPath, CATALOG_FILENAME);
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  }
}
