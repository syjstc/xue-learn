import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  credentialFieldsByProvider,
  credentialFieldsForProviderKey,
  credentialMutationSchema,
  credentialProviderKeySchema,
  isCredentialProviderKey,
  parseCustomChatProfileCredentialProviderId,
  type CredentialMutation,
  type CredentialStatus,
  type LocalProviderId,
} from "@xue-learn/core/runtime-contracts";
import { z } from "zod";

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const credentialMapSchema = z.record(z.string(), z.record(z.string(), z.string().min(1)));
const vaultEnvelopeSchema = z.object({
  version: z.literal(1),
  ciphertext: z.string().min(1),
});

type CredentialMap = z.infer<typeof credentialMapSchema>;

function validateCredentialMap(raw: unknown): CredentialMap {
  const credentials = credentialMapSchema.parse(raw);
  for (const [rawProviderId, values] of Object.entries(credentials)) {
    if (!isCredentialProviderKey(rawProviderId)) {
      throw new Error(`Unsupported local provider: ${rawProviderId}`);
    }
    const allowedFields = new Set<string>(
      credentialFieldsForProviderKey(rawProviderId),
    );
    for (const field of Object.keys(values)) {
      if (!allowedFields.has(field)) {
        throw new Error(`Unsupported credential field: ${rawProviderId}.${field}`);
      }
    }
  }
  return credentials;
}

export class CredentialVault {
  constructor(
    private readonly path: string,
    private readonly safeStorage: SafeStoragePort,
  ) {}

  async getStatuses(): Promise<CredentialStatus[]> {
    const credentials = await this.readAll();
    const base = (Object.keys(credentialFieldsByProvider) as LocalProviderId[]).map(
      (providerId) => ({
        providerId,
        configuredFields: Object.keys(credentials[providerId] ?? {}).sort(),
        healthy: null,
        lastCheckedAt: null,
      }),
    );
    const profileStatuses = Object.keys(credentials)
      .filter((providerId) =>
        Boolean(parseCustomChatProfileCredentialProviderId(providerId)),
      )
      .sort()
      .map((providerId) => ({
        providerId: credentialProviderKeySchema.parse(providerId),
        configuredFields: Object.keys(credentials[providerId] ?? {}).sort(),
        healthy: null,
        lastCheckedAt: null,
      }));
    return [...base, ...profileStatuses];
  }

  async mutate(input: CredentialMutation): Promise<CredentialStatus[]> {
    const mutation = credentialMutationSchema.parse(input);
    const allowedFields = new Set<string>(
      credentialFieldsForProviderKey(mutation.providerId),
    );
    const credentials = await this.readAll();
    const provider = { ...(credentials[mutation.providerId] ?? {}) };

    if (mutation.action === "set") {
      for (const [field, value] of Object.entries(mutation.values)) {
        if (!allowedFields.has(field)) {
          throw new Error(
            `Unsupported credential field: ${mutation.providerId}.${field}`,
          );
        }
        provider[field] = value;
      }
    } else {
      for (const field of mutation.fields) {
        if (!allowedFields.has(field)) {
          throw new Error(
            `Unsupported credential field: ${mutation.providerId}.${field}`,
          );
        }
        delete provider[field];
      }
    }

    if (Object.keys(provider).length === 0) delete credentials[mutation.providerId];
    else credentials[mutation.providerId] = provider;
    await this.writeAll(credentials);
    return this.getStatuses();
  }

  /**
   * Copy one credential slot onto another without exposing secrets to the
   * renderer. Used when activating or migrating OpenAI-compatible profiles.
   */
  async cloneProvider(
    fromProviderId: string,
    toProviderId: string,
  ): Promise<CredentialStatus[]> {
    const from = credentialProviderKeySchema.parse(fromProviderId);
    const to = credentialProviderKeySchema.parse(toProviderId);
    const fromFields = credentialFieldsForProviderKey(from);
    const toFields = credentialFieldsForProviderKey(to);
    if (
      fromFields.length !== toFields.length ||
      fromFields.some((field, index) => field !== toFields[index])
    ) {
      throw new Error("Credential slots must share the same fields to clone");
    }
    const credentials = await this.readAll();
    const source = credentials[from];
    if (!source || Object.keys(source).length === 0) {
      throw new Error(`No credentials to clone from ${from}`);
    }
    credentials[to] = { ...source };
    await this.writeAll(credentials);
    return this.getStatuses();
  }

  /** Delete an entire credential slot (all fields). */
  async clearProvider(providerId: string): Promise<CredentialStatus[]> {
    const key = credentialProviderKeySchema.parse(providerId);
    const credentials = await this.readAll();
    delete credentials[key];
    await this.writeAll(credentials);
    return this.getStatuses();
  }

  /** Only Electron main may call this to create the sidecar bootstrap snapshot. */
  async readForSidecar(): Promise<CredentialMap> {
    return this.readAll();
  }

  private async readAll(): Promise<CredentialMap> {
    let serialized: string;
    try {
      serialized = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    this.assertEncryptionAvailable();
    const envelope = vaultEnvelopeSchema.parse(JSON.parse(serialized));
    const plaintext = this.safeStorage.decryptString(Buffer.from(envelope.ciphertext, "base64"));
    return validateCredentialMap(JSON.parse(plaintext));
  }

  private async writeAll(credentials: CredentialMap): Promise<void> {
    this.assertEncryptionAvailable();
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const encrypted = this.safeStorage.encryptString(JSON.stringify(validateCredentialMap(credentials)));
    const body = `${JSON.stringify({ version: 1, ciphertext: encrypted.toString("base64") })}\n`;
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, body, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.path);
    await chmod(this.path, 0o600);
  }

  private assertEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS Keychain encryption is unavailable; credentials were not accessed");
    }
  }
}
