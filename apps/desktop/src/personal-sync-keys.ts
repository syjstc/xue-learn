import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createWrappedWorkspaceKey,
  decryptSyncPayload,
  encryptSyncPayload,
  rewrapWorkspaceKey,
  unwrapWorkspaceKey,
  wrappedWorkspaceKeySchema,
} from "@xue-learn/core/server/personal-sync/crypto";
import type {
  PersonalSyncConnectInput,
  PersonalSyncPassphraseChange,
  PersonalSyncUnlockInput,
} from "@xue-learn/core/runtime-contracts";
import type { WorkspaceCatalog } from "./workspace-catalog.ts";
import type { WorkspaceKeyVault } from "./workspace-key-vault.ts";

const KEY_BUNDLE_FILENAME = "key-bundle.v1.json";

export type CloudWorkspaceBootstrap = Readonly<{
  workspaceId: string;
  formatVersion: 1;
  wrappedWorkspaceKey: string;
  encryptedName: string;
  createdAt: string;
}>;

export class PersonalSyncKeyManager {
  constructor(
    private readonly catalog: WorkspaceCatalog,
    private readonly vault: WorkspaceKeyVault,
  ) {}

  async connect(
    input: PersonalSyncConnectInput,
  ): Promise<CloudWorkspaceBootstrap> {
    const workspaceId = this.catalog.activeWorkspaceId;
    try {
      const bundle = await this.readBundle();
      const workspaceKey = await unwrapWorkspaceKey(
        workspaceId,
        input.passphrase,
        bundle,
      );
      await this.vault.set(workspaceId, workspaceKey);
      await this.catalog.setCloudSyncEnabled(workspaceId, true);
      return this.bootstrapFor(workspaceId, workspaceKey, bundle);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const created = await createWrappedWorkspaceKey(
      workspaceId,
      input.passphrase,
    );
    await this.writeBundle(created.bundle, workspaceId);
    await this.vault.set(workspaceId, created.workspaceKey);
    await this.catalog.setCloudSyncEnabled(workspaceId, true);
    return this.bootstrapFor(workspaceId, created.workspaceKey, created.bundle);
  }

  private async bootstrapFor(
    workspaceId: string,
    workspaceKey: Buffer,
    bundle: unknown,
  ): Promise<CloudWorkspaceBootstrap> {
    const workspace = this.catalog
      .list()
      .find((item) => item.workspaceId === workspaceId)!;
    const encryptedName = await encryptSyncPayload({
      workspaceId,
      valueId: "workspace-name",
      purpose: "metadata",
      workspaceKey,
      plaintext: Buffer.from(workspace.name, "utf8"),
    });
    return {
      workspaceId,
      formatVersion: 1,
      wrappedWorkspaceKey: JSON.stringify(
        wrappedWorkspaceKeySchema.parse(bundle),
      ),
      encryptedName: JSON.stringify(encryptedName),
      createdAt: workspace.createdAt,
    };
  }

  async join(input: {
    workspaceId: string;
    passphrase: string;
    wrappedWorkspaceKey: string;
    encryptedName: string;
    syncFolderPath: string;
  }): Promise<void> {
    const bundle = wrappedWorkspaceKeySchema.parse(
      JSON.parse(input.wrappedWorkspaceKey),
    );
    const key = await unwrapWorkspaceKey(
      input.workspaceId,
      input.passphrase,
      bundle,
    );
    const name = (
      await decryptSyncPayload({
        workspaceId: input.workspaceId,
        valueId: "workspace-name",
        purpose: "metadata",
        workspaceKey: key,
        envelope: JSON.parse(input.encryptedName),
      })
    ).toString("utf8");
    await this.catalog.createJoined(input.workspaceId, name);
    await this.catalog.setFolderSyncPath(
      input.workspaceId,
      input.syncFolderPath,
    );
    await this.writeBundle(bundle, input.workspaceId);
    await this.vault.set(input.workspaceId, key);
  }

  async unlock(input: PersonalSyncUnlockInput): Promise<void> {
    const workspaceId = this.catalog.activeWorkspaceId;
    const key = await unwrapWorkspaceKey(
      workspaceId,
      input.passphrase,
      await this.readBundle(),
    );
    await this.vault.set(workspaceId, key);
  }

  async changePassphrase(
    input: PersonalSyncPassphraseChange,
  ): Promise<CloudWorkspaceBootstrap> {
    const bundle = await rewrapWorkspaceKey({
      workspaceId: this.catalog.activeWorkspaceId,
      currentPassphrase: input.currentPassphrase,
      nextPassphrase: input.nextPassphrase,
      bundle: await this.readBundle(),
    });
    await this.writeBundle(bundle);
    const workspaceId = this.catalog.activeWorkspaceId;
    const workspaceKey = await unwrapWorkspaceKey(
      workspaceId,
      input.nextPassphrase,
      bundle,
    );
    await this.vault.set(workspaceId, workspaceKey);
    return this.bootstrapFor(workspaceId, workspaceKey, bundle);
  }

  async disconnect(): Promise<void> {
    const workspaceId = this.catalog.activeWorkspaceId;
    await this.catalog.setCloudSyncEnabled(workspaceId, false);
    await this.vault.remove(workspaceId);
  }

  async isLocked(workspaceId: string): Promise<boolean> {
    const workspace = this.catalog
      .list()
      .find((candidate) => candidate.workspaceId === workspaceId);
    return Boolean(
      workspace?.cloudSyncEnabled && !(await this.vault.has(workspaceId)),
    );
  }

  private bundlePath(workspaceId = this.catalog.activeWorkspaceId): string {
    return join(
      this.catalog.workspacePath(workspaceId),
      "sync",
      KEY_BUNDLE_FILENAME,
    );
  }

  private async readBundle() {
    return wrappedWorkspaceKeySchema.parse(
      JSON.parse(await readFile(this.bundlePath(), "utf8")),
    );
  }

  private async writeBundle(
    bundle: unknown,
    workspaceId = this.catalog.activeWorkspaceId,
  ): Promise<void> {
    const workspacePath = this.catalog.workspacePath(workspaceId);
    const path = this.bundlePath(workspaceId);
    const temporaryPath = `${path}.tmp`;
    await mkdir(join(workspacePath, "sync"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      temporaryPath,
      `${JSON.stringify(wrappedWorkspaceKeySchema.parse(bundle), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  }
}
