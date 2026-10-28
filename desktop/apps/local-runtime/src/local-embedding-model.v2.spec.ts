import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  BUILTIN_EMBEDDING_ASSET_PATHS,
  BUILTIN_EMBEDDING_MODEL_FILE,
  BUILTIN_EMBEDDING_MODEL_ID,
  BUILTIN_EMBEDDING_MODEL_REVISION,
} from "@xue-learn/core/runtime-contracts";
import { validateLocalEmbeddingModel } from "./local-embedding-model.ts";

describe("downloaded local embedding model validation", () => {
  const userData = join(tmpdir(), `xuelearn-model-${randomUUID()}`);
  const workspaceDataPath = join(userData, "workspaces", randomUUID());
  const modelRoot = join(
    userData,
    "models",
    BUILTIN_EMBEDDING_MODEL_ID.replaceAll("/", "--"),
    BUILTIN_EMBEDDING_MODEL_REVISION,
  );
  const manifestPath = join(modelRoot, "manifest.json");

  beforeEach(() => {
    mkdirSync(modelRoot, { recursive: true });
    const files = BUILTIN_EMBEDDING_ASSET_PATHS.map((path) => {
      const data = Buffer.from(`fixture:${path}`);
      const target = join(modelRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      return {
        path,
        size: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
      };
    });
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        modelId: BUILTIN_EMBEDDING_MODEL_ID,
        source: {
          repository: "Qwen/Qwen3-Embedding-0.6B-GGUF",
          revision: BUILTIN_EMBEDDING_MODEL_REVISION,
        },
        files,
      }),
    );
  });

  afterEach(() => rmSync(userData, { recursive: true, force: true }));

  it("accepts a complete verified download outside the workspace data directory", async () => {
    await expect(
      validateLocalEmbeddingModel({ modelRoot, manifestPath }),
    ).resolves.toMatchObject({
      modelId: BUILTIN_EMBEDDING_MODEL_ID,
    });
    expect(modelRoot.startsWith(workspaceDataPath)).toBe(false);
  });

  it("rejects corrupt assets and files outside the model directory", async () => {
    writeFileSync(join(modelRoot, BUILTIN_EMBEDDING_MODEL_FILE), "corrupt");
    await expect(
      validateLocalEmbeddingModel({ modelRoot, manifestPath }),
    ).rejects.toThrow(/wrong size|integrity validation/);

    await expect(
      validateLocalEmbeddingModel({
        modelRoot,
        manifestPath: join(tmpdir(), "manifest.json"),
      }),
    ).rejects.toThrow("must stay inside the embedding model directory");
  });

  it("reports a missing install without leaking a filesystem lstat error", async () => {
    const missingRoot = join(userData, "missing-model");
    await expect(
      validateLocalEmbeddingModel({
        modelRoot: missingRoot,
        manifestPath: join(missingRoot, "manifest.json"),
      }),
    ).rejects.toThrow("Qwen embedding model is not installed");
  });
});
