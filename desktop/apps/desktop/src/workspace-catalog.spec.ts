import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_LOCAL_DATABASE_FILENAME } from "@xue-learn/core/runtime-contracts";
import { WorkspaceCatalog } from "./workspace-catalog.ts";

describe("desktop workspace catalog", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "xuelearn-workspaces-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("preserves a root legacy database, WAL and resources when the catalog is absent", async () => {
    await writeFile(join(root, DESKTOP_LOCAL_DATABASE_FILENAME), "database");
    await writeFile(join(root, DESKTOP_LOCAL_DATABASE_FILENAME + "-wal"), "saved-wal");
    await mkdir(join(root, "resources", "objects"), { recursive: true });
    await writeFile(join(root, "resources", "objects", "original.txt"), "resource");
    await expect(WorkspaceCatalog.open(root)).rejects.toThrow("LEGACY_WORKSPACE_IMPORT_REQUIRED");
    expect(await readFile(join(root, DESKTOP_LOCAL_DATABASE_FILENAME), "utf8")).toBe("database");
    expect(await readFile(join(root, DESKTOP_LOCAL_DATABASE_FILENAME + "-wal"), "utf8")).toBe("saved-wal");
    expect(await readFile(join(root, "resources", "objects", "original.txt"), "utf8")).toBe("resource");
    await expect(readFile(join(root, "workspace-catalog.v1.json"))).rejects.toMatchObject({code:"ENOENT"});
  });

  it("preserves separate workspaces and persists the active selection", async () => {
    const catalog = await WorkspaceCatalog.open(root);
    const created = await catalog.create("Imported cloud workspace");
    await catalog.switchTo(created.workspaceId);

    const reopened = await WorkspaceCatalog.open(root);
    expect(reopened.activeWorkspaceId).toBe(created.workspaceId);
    expect(reopened.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "My learning workspace",
          active: false,
        }),
        expect.objectContaining({
          name: "Imported cloud workspace",
          active: true,
        }),
      ]),
    );
  });

  it("returns legacy CloudKit-only workspaces to local mode so folder setup is available", async () => {
    const workspaceId = "2f551cc2-c374-4bc0-9701-b24d3890d8ab";
    const now = new Date().toISOString();
    await writeFile(
      join(root, "workspace-catalog.v1.json"),
      JSON.stringify({
        version: 1,
        activeWorkspaceId: workspaceId,
        workspaces: [
          {
            workspaceId,
            name: "Legacy CloudKit workspace",
            cloudSyncEnabled: true,
            createdAt: now,
            lastOpenedAt: now,
          },
        ],
      }),
    );

    const catalog = await WorkspaceCatalog.open(root);

    expect(catalog.list()[0]).toMatchObject({
      cloudSyncEnabled: false,
      syncTransport: null,
      syncFolderPath: null,
    });
  });
});
