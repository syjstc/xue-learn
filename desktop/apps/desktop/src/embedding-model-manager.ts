import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  BUILTIN_EMBEDDING_MODEL_BYTES,
  BUILTIN_EMBEDDING_MODEL_FILE,
  BUILTIN_EMBEDDING_MODEL_ID,
  BUILTIN_EMBEDDING_MODEL_REVISION,
  BUILTIN_EMBEDDING_MODEL_SHA256,
  embeddingModelDownloadSourceSchema,
  embeddingModelInstallStatusSchema,
  localEmbeddingModelManifestSchema,
  type EmbeddingModelDownloadSource,
  type EmbeddingModelInstallStatus,
  type LocalEmbeddingModelManifest,
} from "@xue-learn/core/runtime-contracts";

const SOURCE_URLS: Record<EmbeddingModelDownloadSource, string> = {
  modelscope:
    "https://modelscope.cn/models/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/master/Qwen3-Embedding-0.6B-Q8_0.gguf",
  huggingface: `https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/${BUILTIN_EMBEDDING_MODEL_REVISION}/Qwen3-Embedding-0.6B-Q8_0.gguf?download=true`,
};

const MANIFEST: LocalEmbeddingModelManifest =
  localEmbeddingModelManifestSchema.parse({
    schemaVersion: 1,
    modelId: BUILTIN_EMBEDDING_MODEL_ID,
    source: {
      repository: "Qwen/Qwen3-Embedding-0.6B-GGUF",
      revision: BUILTIN_EMBEDDING_MODEL_REVISION,
    },
    files: [
      {
        path: BUILTIN_EMBEDDING_MODEL_FILE,
        sha256: BUILTIN_EMBEDDING_MODEL_SHA256,
        size: BUILTIN_EMBEDDING_MODEL_BYTES,
      },
    ],
  });

async function sha256(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

export class EmbeddingModelManager {
  readonly modelRoot: string;
  readonly manifestPath: string;
  private state: EmbeddingModelInstallStatus = {
    state: "not_installed",
    modelId: BUILTIN_EMBEDDING_MODEL_ID,
    source: null,
    downloadedBytes: 0,
    totalBytes: BUILTIN_EMBEDDING_MODEL_BYTES,
    error: null,
  };
  private installPromise: Promise<void> | null = null;

  constructor(
    dataPath: string,
    private readonly afterInstall: () => Promise<void>,
  ) {
    this.modelRoot = join(
      dataPath,
      "models",
      BUILTIN_EMBEDDING_MODEL_ID.replaceAll("/", "--"),
      BUILTIN_EMBEDDING_MODEL_REVISION,
    );
    this.manifestPath = join(this.modelRoot, "manifest.json");
  }

  async getStatus(): Promise<EmbeddingModelInstallStatus> {
    if (!this.installPromise && this.state.state !== "failed") {
      this.state = (await this.hasInstalledModel())
        ? {
            ...this.state,
            state: "installed",
            downloadedBytes: BUILTIN_EMBEDDING_MODEL_BYTES,
            error: null,
          }
        : {
            ...this.state,
            state: "not_installed",
            downloadedBytes: 0,
            error: null,
          };
    }
    return embeddingModelInstallStatusSchema.parse(this.state);
  }

  async install(
    rawSource: EmbeddingModelDownloadSource,
  ): Promise<EmbeddingModelInstallStatus> {
    const source = embeddingModelDownloadSourceSchema.parse(rawSource);
    if (!this.installPromise) {
      this.state = {
        ...this.state,
        state: "downloading",
        source,
        downloadedBytes: 0,
        error: null,
      };
      this.installPromise = this.download(source)
        .then(async () => {
          await this.afterInstall();
          this.state = {
            ...this.state,
            state: "installed",
            downloadedBytes: BUILTIN_EMBEDDING_MODEL_BYTES,
            error: null,
          };
        })
        .catch((error) => {
          this.state = {
            ...this.state,
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          };
        })
        .finally(() => {
          this.installPromise = null;
        });
    }
    return embeddingModelInstallStatusSchema.parse(this.state);
  }

  private async hasInstalledModel(): Promise<boolean> {
    try {
      const [manifestBody, info] = await Promise.all([
        readFile(this.manifestPath, "utf8"),
        stat(join(this.modelRoot, BUILTIN_EMBEDDING_MODEL_FILE)),
      ]);
      const manifest = localEmbeddingModelManifestSchema.parse(
        JSON.parse(manifestBody),
      );
      return (
        info.isFile() &&
        info.size === BUILTIN_EMBEDDING_MODEL_BYTES &&
        manifest.modelId === MANIFEST.modelId &&
        manifest.source.repository === MANIFEST.source.repository &&
        manifest.source.revision === MANIFEST.source.revision &&
        manifest.files.length === 1 &&
        manifest.files[0]?.path === BUILTIN_EMBEDDING_MODEL_FILE &&
        manifest.files[0]?.size === BUILTIN_EMBEDDING_MODEL_BYTES &&
        manifest.files[0]?.sha256 === BUILTIN_EMBEDDING_MODEL_SHA256 &&
        (await sha256(join(this.modelRoot, BUILTIN_EMBEDDING_MODEL_FILE))) ===
          BUILTIN_EMBEDDING_MODEL_SHA256
      );
    } catch {
      return false;
    }
  }

  private async download(source: EmbeddingModelDownloadSource): Promise<void> {
    await mkdir(this.modelRoot, { recursive: true, mode: 0o700 });
    const finalPath = join(this.modelRoot, BUILTIN_EMBEDDING_MODEL_FILE);
    const temporaryPath = `${finalPath}.partial`;
    await rm(temporaryPath, { force: true });
    try {
      const response = await fetch(SOURCE_URLS[source], {
        redirect: "follow",
        headers: { "User-Agent": "XueLearn Desktop" },
      });
      if (!response.ok || !response.body) {
        throw new Error(`Model download failed (${response.status})`);
      }
      const file = await open(temporaryPath, "w", 0o600);
      try {
        const reader = response.body.getReader();
        let downloadedBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          downloadedBytes += value.byteLength;
          if (downloadedBytes > BUILTIN_EMBEDDING_MODEL_BYTES) {
            throw new Error("Model download exceeded the reviewed file size");
          }
          await file.write(value);
          this.state = { ...this.state, downloadedBytes };
        }
        await file.sync();
      } finally {
        await file.close();
      }
      const info = await stat(temporaryPath);
      if (info.size !== BUILTIN_EMBEDDING_MODEL_BYTES) {
        throw new Error("Downloaded model has the wrong size");
      }
      if ((await sha256(temporaryPath)) !== BUILTIN_EMBEDDING_MODEL_SHA256) {
        throw new Error("Downloaded model failed integrity validation");
      }
      // Windows rename does not replace an existing corrupt model file.
      await rm(finalPath, { force: true });
      await rename(temporaryPath, finalPath);
      await writeFile(
        this.manifestPath,
        `${JSON.stringify(MANIFEST, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      );
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
