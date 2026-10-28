import { z } from "zod";
import { BUILTIN_EMBEDDING_MODEL_ID } from "./providers.js";

const safeModelRelativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !value.split(/[\\/]+/).includes(".."),
    "Model file path must stay inside the model root",
  );

export const BUILTIN_EMBEDDING_ASSET_PATHS = [
  "Qwen3-Embedding-0.6B-Q8_0.gguf",
] as const;

export const BUILTIN_EMBEDDING_MODEL_REVISION =
  "d20cf9c16f82914a21dbd9c645f56895fb1d7750";
export const BUILTIN_EMBEDDING_MODEL_FILE =
  "Qwen3-Embedding-0.6B-Q8_0.gguf" as const;
export const BUILTIN_EMBEDDING_MODEL_BYTES = 639_150_592;
export const BUILTIN_EMBEDDING_MODEL_SHA256 =
  "06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439";

export const localEmbeddingModelManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    modelId: z.literal(BUILTIN_EMBEDDING_MODEL_ID),
    source: z.object({
      repository: z.literal("Qwen/Qwen3-Embedding-0.6B-GGUF"),
      revision: z.literal(BUILTIN_EMBEDDING_MODEL_REVISION),
    }),
    files: z
      .array(
        z.object({
          path: safeModelRelativePath,
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          size: z.number().int().positive(),
        }),
      )
      .min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const actual = [...manifest.files.map((file) => file.path)].sort();
    const expected = [...BUILTIN_EMBEDDING_ASSET_PATHS].sort();
    if (
      actual.length !== expected.length ||
      actual.some((path, index) => path !== expected[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Manifest must contain the complete reviewed model asset set",
      });
    }
  });
export type LocalEmbeddingModelManifest = z.infer<
  typeof localEmbeddingModelManifestSchema
>;

export const embeddingModelDownloadSourceIds = [
  "modelscope",
  "huggingface",
] as const;
export const embeddingModelDownloadSourceSchema = z.enum(
  embeddingModelDownloadSourceIds,
);
export type EmbeddingModelDownloadSource = z.infer<
  typeof embeddingModelDownloadSourceSchema
>;

export const embeddingModelInstallStatusSchema = z.object({
  state: z.enum(["not_installed", "downloading", "installed", "failed"]),
  modelId: z.literal(BUILTIN_EMBEDDING_MODEL_ID),
  source: embeddingModelDownloadSourceSchema.nullable(),
  downloadedBytes: z.number().int().nonnegative(),
  totalBytes: z.literal(BUILTIN_EMBEDDING_MODEL_BYTES),
  error: z.string().min(1).nullable(),
});
export type EmbeddingModelInstallStatus = z.infer<
  typeof embeddingModelInstallStatusSchema
>;
