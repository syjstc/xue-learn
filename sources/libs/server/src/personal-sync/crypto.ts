import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { brotliCompress, brotliDecompress } from "node:zlib";
import { promisify } from "node:util";
import { z } from "zod";

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);

export const PERSONAL_SYNC_KDF = Object.freeze({
  name: "scrypt" as const,
  version: 1 as const,
  N: 131_072,
  r: 8,
  p: 1,
  keyLength: 32,
  maxmem: 256 * 1024 * 1024,
});

const encryptedValueSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  nonce: z.string().min(1),
  ciphertext: z.string().min(1),
  authTag: z.string().min(1),
});
export type EncryptedSyncValue = z.infer<typeof encryptedValueSchema>;

export const wrappedWorkspaceKeySchema = z.object({
  formatVersion: z.literal(1),
  kdf: z.object({
    name: z.literal("scrypt"),
    version: z.literal(1),
    N: z.literal(PERSONAL_SYNC_KDF.N),
    r: z.literal(PERSONAL_SYNC_KDF.r),
    p: z.literal(PERSONAL_SYNC_KDF.p),
    keyLength: z.literal(PERSONAL_SYNC_KDF.keyLength),
  }),
  salt: z.string().min(1),
  wrappedKey: encryptedValueSchema,
  verifier: z.string().min(1),
});
export type WrappedWorkspaceKey = z.infer<
  typeof wrappedWorkspaceKeySchema
>;

export const encryptedSyncEnvelopeSchema = z.object({
  formatVersion: z.literal(1),
  compression: z.literal("brotli"),
  value: encryptedValueSchema,
});
export type EncryptedSyncEnvelope = z.infer<
  typeof encryptedSyncEnvelopeSchema
>;

function requirePassphrase(passphrase: string): void {
  if ([...passphrase].length < 12) {
    throw new Error("Sync passphrase must contain at least 12 Unicode characters");
  }
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  requirePassphrase(passphrase);
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase.normalize("NFKC"),
      salt,
      PERSONAL_SYNC_KDF.keyLength,
      {
        N: PERSONAL_SYNC_KDF.N,
        r: PERSONAL_SYNC_KDF.r,
        p: PERSONAL_SYNC_KDF.p,
        maxmem: PERSONAL_SYNC_KDF.maxmem,
      },
      (error, value) => {
        if (error) reject(error);
        else resolve(value);
      },
    );
  });
}

function associatedData(input: {
  purpose: string;
  workspaceId: string;
  valueId: string;
}): Buffer {
  return Buffer.from(
    `xuelearn-personal-sync\0v1\0${input.purpose}\0${input.workspaceId}\0${input.valueId}`,
    "utf8",
  );
}

function encryptBytes(
  plaintext: Buffer,
  key: Buffer,
  aad: Buffer,
): EncryptedSyncValue {
  if (key.byteLength !== 32) throw new Error("Workspace key must be 32 bytes");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptBytes(
  raw: EncryptedSyncValue,
  key: Buffer,
  aad: Buffer,
): Buffer {
  const value = encryptedValueSchema.parse(raw);
  if (key.byteLength !== 32) throw new Error("Workspace key must be 32 bytes");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.nonce, "base64"),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]);
}

export async function createWrappedWorkspaceKey(
  workspaceId: string,
  passphrase: string,
): Promise<{ workspaceKey: Buffer; bundle: WrappedWorkspaceKey }> {
  const workspaceKey = randomBytes(32);
  const salt = randomBytes(32);
  const wrappingKey = await deriveKey(passphrase, salt);
  const aad = associatedData({
    purpose: "workspace-key",
    workspaceId,
    valueId: "primary",
  });
  const verifierBytes = encryptBytes(
    Buffer.from("xuelearn-personal-sync-key-verifier-v1", "utf8"),
    workspaceKey,
    aad,
  );
  const verifier = Buffer.from(JSON.stringify(verifierBytes)).toString("base64");
  return {
    workspaceKey,
    bundle: {
      formatVersion: 1,
      kdf: {
        name: "scrypt",
        version: 1,
        N: PERSONAL_SYNC_KDF.N,
        r: PERSONAL_SYNC_KDF.r,
        p: PERSONAL_SYNC_KDF.p,
        keyLength: PERSONAL_SYNC_KDF.keyLength,
      },
      salt: salt.toString("base64"),
      wrappedKey: encryptBytes(workspaceKey, wrappingKey, aad),
      verifier,
    },
  };
}

export async function unwrapWorkspaceKey(
  workspaceId: string,
  passphrase: string,
  rawBundle: WrappedWorkspaceKey,
): Promise<Buffer> {
  const bundle = wrappedWorkspaceKeySchema.parse(rawBundle);
  const aad = associatedData({
    purpose: "workspace-key",
    workspaceId,
    valueId: "primary",
  });
  let workspaceKey: Buffer;
  try {
    const wrappingKey = await deriveKey(
      passphrase,
      Buffer.from(bundle.salt, "base64"),
    );
    workspaceKey = decryptBytes(bundle.wrappedKey, wrappingKey, aad);
    const verifier = encryptedValueSchema.parse(
      JSON.parse(Buffer.from(bundle.verifier, "base64").toString("utf8")),
    );
    const expected = Buffer.from("xuelearn-personal-sync-key-verifier-v1", "utf8");
    const actual = decryptBytes(verifier, workspaceKey, aad);
    if (
      expected.byteLength !== actual.byteLength ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new Error("Workspace key verification failed");
    }
  } catch {
    throw new Error("The sync passphrase is incorrect or the key bundle is damaged");
  }
  return workspaceKey;
}

export async function rewrapWorkspaceKey(input: {
  workspaceId: string;
  currentPassphrase: string;
  nextPassphrase: string;
  bundle: WrappedWorkspaceKey;
}): Promise<WrappedWorkspaceKey> {
  const workspaceKey = await unwrapWorkspaceKey(
    input.workspaceId,
    input.currentPassphrase,
    input.bundle,
  );
  const salt = randomBytes(32);
  const wrappingKey = await deriveKey(input.nextPassphrase, salt);
  const aad = associatedData({
    purpose: "workspace-key",
    workspaceId: input.workspaceId,
    valueId: "primary",
  });
  return {
    ...input.bundle,
    salt: salt.toString("base64"),
    wrappedKey: encryptBytes(workspaceKey, wrappingKey, aad),
  };
}

export async function encryptSyncPayload(input: {
  workspaceId: string;
  valueId: string;
  purpose: "commit" | "snapshot" | "blob" | "metadata";
  workspaceKey: Buffer;
  plaintext: Buffer;
}): Promise<EncryptedSyncEnvelope> {
  const compressed = await compress(input.plaintext);
  return {
    formatVersion: 1,
    compression: "brotli",
    value: encryptBytes(
      compressed,
      input.workspaceKey,
      associatedData(input),
    ),
  };
}

export async function decryptSyncPayload(input: {
  workspaceId: string;
  valueId: string;
  purpose: "commit" | "snapshot" | "blob" | "metadata";
  workspaceKey: Buffer;
  envelope: EncryptedSyncEnvelope;
}): Promise<Buffer> {
  const envelope = encryptedSyncEnvelopeSchema.parse(input.envelope);
  const compressed = decryptBytes(
    envelope.value,
    input.workspaceKey,
    associatedData(input),
  );
  return decompress(compressed);
}

