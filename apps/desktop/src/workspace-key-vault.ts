import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspaceIdSchema } from "@xue-learn/core/source/libs/runtime-contracts/src/index.ts";
import { z } from "zod";
import type { SafeStoragePort } from "./credential-vault.ts";

const envelopeSchema = z.object({
  version: z.literal(1),
  ciphertext: z.string().min(1),
});
const keyMapSchema = z.record(
  workspaceIdSchema,
  z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
);
type KeyMap = z.infer<typeof keyMapSchema>;

export class WorkspaceKeyVault {
  constructor(
    private readonly path: string,
    private readonly safeStorage: SafeStoragePort,
  ) {}

  async has(workspaceId: string): Promise<boolean> {
    return Boolean((await this.readAll())[workspaceIdSchema.parse(workspaceId)]);
  }

  async read(workspaceId: string): Promise<Buffer | null> {
    const encoded = (await this.readAll())[workspaceIdSchema.parse(workspaceId)];
    return encoded ? Buffer.from(encoded, "base64") : null;
  }

  async set(workspaceId: string, workspaceKey: Buffer): Promise<void> {
    if (workspaceKey.byteLength !== 32)
      throw new Error("Workspace key must be 32 bytes");
    const keys = await this.readAll();
    keys[workspaceIdSchema.parse(workspaceId)] = workspaceKey.toString("base64");
    await this.writeAll(keys);
  }

  async remove(workspaceId: string): Promise<void> {
    const keys = await this.readAll();
    delete keys[workspaceIdSchema.parse(workspaceId)];
    await this.writeAll(keys);
  }

  async configuredWorkspaceIds(): Promise<Set<string>> {
    return new Set(Object.keys(await this.readAll()));
  }

  private async readAll(): Promise<KeyMap> {
    let serialized: string;
    try {
      serialized = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    this.assertEncryptionAvailable();
    const envelope = envelopeSchema.parse(JSON.parse(serialized));
    const plaintext = this.safeStorage.decryptString(
      Buffer.from(envelope.ciphertext, "base64"),
    );
    return keyMapSchema.parse(JSON.parse(plaintext));
  }

  private async writeAll(keys: KeyMap): Promise<void> {
    this.assertEncryptionAvailable();
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const ciphertext = this.safeStorage.encryptString(
      JSON.stringify(keyMapSchema.parse(keys)),
    );
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, ciphertext: ciphertext.toString("base64") })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }

  private assertEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error("Operating-system encryption is unavailable");
  }
}

