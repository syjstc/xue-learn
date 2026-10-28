import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  localEmbeddingModelManifestSchema,
  type LocalEmbeddingModelManifest,
} from "@xue-learn/core/runtime-contracts";

function requireContainedPath(root: string, target: string, label: string) {
  const resolvedRoot = realpathSync(resolve(root));
  const candidate = resolve(target);
  const resolvedTarget = existsSync(candidate)
    ? realpathSync(candidate)
    : candidate;
  const child = relative(resolvedRoot, resolvedTarget);
  if (
    !child ||
    child === "." ||
    child.startsWith(`..${sep}`) ||
    child === ".."
  ) {
    throw new Error(`${label} must stay inside the embedding model directory`);
  }
  return resolvedTarget;
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveStream, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolveStream);
  });
  return hash.digest("hex");
}

export async function validateLocalEmbeddingModel(input: {
  modelRoot: string;
  manifestPath: string;
}): Promise<LocalEmbeddingModelManifest> {
  if (!existsSync(resolve(input.modelRoot))) {
    throw new Error("The downloaded Qwen embedding model is not installed");
  }
  // Downloads live in Electron userData/models, not the workspace SQLite
  // directory or packaged resourcesPath. Containment is enforced for files
  // inside this reviewed model root rather than against those other roots.
  const modelRoot = realpathSync(resolve(input.modelRoot));
  const manifestPath = requireContainedPath(
    modelRoot,
    input.manifestPath,
    "Embedding model manifest",
  );
  if (!existsSync(manifestPath)) {
    throw new Error("The downloaded Qwen embedding model is not installed");
  }
  const manifest = localEmbeddingModelManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")),
  );
  for (const file of manifest.files) {
    const path = requireContainedPath(
      modelRoot,
      resolve(modelRoot, file.path),
      file.path,
    );
    if (!existsSync(path))
      throw new Error(`Downloaded embedding file is missing: ${file.path}`);
    const size = statSync(path).size;
    if (size !== file.size) {
      throw new Error(
        `Downloaded embedding file has the wrong size: ${file.path}`,
      );
    }
    const digest = await hashFile(path);
    if (digest !== file.sha256) {
      throw new Error(
        `Downloaded embedding file failed integrity validation: ${file.path}`,
      );
    }
  }
  return manifest;
}
