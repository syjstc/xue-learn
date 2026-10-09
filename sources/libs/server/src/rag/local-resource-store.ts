import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export type StoredLocalResource = Readonly<{
  storageKey: string;
  contentHash: string;
  contentType: string;
  byteSize: number;
}>;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const STORAGE_KEY_PATTERN =
  /^[a-f0-9]{2}\/[a-f0-9]{64}\/original\.(?:pdf|txt|md|markdown|doc|docx)$/;

function configuredRoot(): string | null {
  const value = process.env.XUELEARN_LOCAL_RESOURCE_ROOT?.trim();
  return value ? resolve(value) : null;
}

function normalizedExtension(filename: string): string {
  return extname(filename).toLowerCase();
}

function assertFileSignature(buffer: Buffer, extension: string): void {
  if (
    extension === ".pdf" &&
    !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
  ) {
    throw new Error(
      "The uploaded file does not contain a valid PDF signature.",
    );
  }
  if (
    extension === ".docx" &&
    buffer.subarray(0, 2).toString("binary") !== "PK"
  ) {
    throw new Error(
      "The uploaded file does not contain a valid DOCX signature.",
    );
  }
  if (
    extension === ".doc" &&
    !buffer
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    throw new Error(
      "The uploaded file does not contain a valid DOC signature.",
    );
  }
  if ([".txt", ".md", ".markdown"].includes(extension) && buffer.includes(0)) {
    throw new Error("The uploaded text resource contains binary data.");
  }
}

export function isLocalResourceStorageEnabled(): boolean {
  return configuredRoot() !== null;
}

export async function storeLocalResource(
  buffer: Buffer,
  filename: string,
): Promise<StoredLocalResource | null> {
  const root = configuredRoot();
  if (!root) return null;

  const extension = normalizedExtension(filename);
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) throw new Error("Unsupported local resource type.");
  assertFileSignature(buffer, extension);

  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const storageKey = `${contentHash.slice(0, 2)}/${contentHash}/original${extension}`;
  const destination = resolveLocalResourcePath(storageKey, root);
  const directory = resolve(destination, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });

  try {
    const existing = await stat(destination);
    if (!existing.isFile())
      throw new Error("Local resource target is not a file.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const temporary = resolve(directory, `.upload-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, buffer, { mode: 0o600, flag: "wx" });
      await rename(temporary, destination);
      await chmod(destination, 0o600);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  return {
    storageKey,
    contentHash,
    contentType,
    byteSize: buffer.byteLength,
  };
}

export function resolveLocalResourcePath(
  storageKey: string,
  explicitRoot?: string,
): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error("Invalid local resource storage key.");
  }
  const root = resolve(explicitRoot ?? configuredRoot() ?? "");
  if (!root || (!explicitRoot && !configuredRoot())) {
    throw new Error("Local resource storage is unavailable.");
  }
  const target = resolve(root, ...storageKey.split("/"));
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error("Local resource path escapes its storage root.");
  }
  return target;
}

export async function deleteLocalResource(storageKey: string): Promise<void> {
  const root = configuredRoot();
  if (!root) return;
  await unlink(resolveLocalResourcePath(storageKey, root)).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}
