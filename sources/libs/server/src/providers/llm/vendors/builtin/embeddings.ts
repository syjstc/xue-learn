import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import {
  BUILTIN_EMBEDDING_DIMENSIONS,
  BUILTIN_EMBEDDING_MODEL_FILE,
  BUILTIN_EMBEDDING_MODEL_ID,
} from "../../../../../../runtime-contracts/src/index.js";
import type { Env } from "../../../../env.js";

const MAX_INPUT_CHARS = 32_000;
const QUERY_INSTRUCTION =
  "Given a search query, retrieve relevant passages that answer the query";

type EmbeddingContextLike = {
  getEmbeddingFor(input: string): Promise<{ vector: readonly number[] }>;
};
type LlamaLogLevelName =
  | "disabled"
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "log"
  | "debug";
type LlamaRuntime = {
  getLlama(options?: {
    progressLogs?: boolean;
    logger?: (level: LlamaLogLevelName, message: string) => void;
  }): Promise<{
    loadModel(input: { modelPath: string }): Promise<{
      createEmbeddingContext(input?: {
        contextSize?: number;
      }): Promise<EmbeddingContextLike>;
    }>;
  }>;
};

/** Official Qwen GGUF tokenizer metadata; llama.cpp already overrides the type. */
export function isBenignQwenGgufTokenizerWarning(message: string): boolean {
  return (
    message.includes("control-looking token:") &&
    message.includes("was not control-type")
  );
}

function logLlamaCpp(level: LlamaLogLevelName, message: string): void {
  if (level === "disabled" || isBenignQwenGgufTokenizerWarning(message)) {
    return;
  }
  if (level === "fatal" || level === "error" || level === "warn") {
    // Match node-llama-cpp: console.warn avoids printing a stack frame.
    console.warn(`[node-llama-cpp] ${message}`);
  }
}
type RuntimeLoader = () => Promise<LlamaRuntime>;

const importLlamaRuntime: RuntimeLoader = () => {
  // Keep llama.cpp and its native bindings out of hosted service bundles.
  const dynamicImport = globalThis.eval("(specifier) => import(specifier)") as (
    specifier: string,
  ) => Promise<LlamaRuntime>;
  return dynamicImport("node-llama-cpp");
};

let runtimeLoader: RuntimeLoader = importLlamaRuntime;
let contextPromise: Promise<EmbeddingContextLike> | null = null;
let inferenceTail: Promise<void> = Promise.resolve();

function requireModelPath(env: Env): string {
  const validationError = env.XUELEARN_LOCAL_EMBEDDING_MODEL_ERROR?.trim();
  if (validationError) {
    throw new Error(
      `The local Qwen embedding model is unavailable: ${validationError}`,
    );
  }
  const configured = env.XUELEARN_LOCAL_EMBEDDING_MODEL_ROOT?.trim();
  if (!configured) {
    throw new Error(
      "Download Qwen3 Embedding before using local semantic search",
    );
  }
  const path = join(resolve(configured), BUILTIN_EMBEDDING_MODEL_FILE);
  if (!existsSync(path)) {
    throw new Error(`The downloaded Qwen embedding model is missing: ${path}`);
  }
  return path;
}

async function loadContext(env: Env): Promise<EmbeddingContextLike> {
  if (!contextPromise) {
    contextPromise = (async () => {
      try {
        const runtime = await runtimeLoader();
        const llama = await runtime.getLlama({
          progressLogs: false,
          logger: logLlamaCpp,
        });
        const model = await llama.loadModel({
          modelPath: requireModelPath(env),
        });
        return await model.createEmbeddingContext({ contextSize: 8192 });
      } catch (error) {
        contextPromise = null;
        throw new Error(
          `Failed to load ${BUILTIN_EMBEDDING_MODEL_ID}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
    })();
  }
  return contextPromise;
}

function normalizeMatryoshkaVector(vector: readonly number[]): number[] {
  if (
    vector.length < BUILTIN_EMBEDDING_DIMENSIONS ||
    !vector.every((entry) => Number.isFinite(entry))
  ) {
    throw new Error(
      `Qwen embeddings must contain at least ${BUILTIN_EMBEDDING_DIMENSIONS} finite dimensions`,
    );
  }
  const truncated = vector.slice(0, BUILTIN_EMBEDDING_DIMENSIONS);
  const norm = Math.sqrt(
    truncated.reduce((sum, entry) => sum + entry * entry, 0),
  );
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("Qwen embeddings returned an empty vector");
  }
  return truncated.map((entry) => entry / norm);
}

function serializeInference<T>(work: () => Promise<T>): Promise<T> {
  const next = inferenceTail.then(work, work);
  inferenceTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function bounded(text: string): string {
  return text.slice(0, MAX_INPUT_CHARS);
}

export class BuiltinEmbeddings extends Embeddings {
  constructor(
    private readonly env: Env,
    params?: EmbeddingsParams,
  ) {
    super(params ?? {});
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) return [];
    return serializeInference(async () => {
      const context = await loadContext(this.env);
      const vectors: number[][] = [];
      for (const document of documents) {
        const embedding = await context.getEmbeddingFor(bounded(document));
        vectors.push(normalizeMatryoshkaVector(embedding.vector));
      }
      return vectors;
    });
  }

  async embedQuery(query: string): Promise<number[]> {
    return serializeInference(async () => {
      const context = await loadContext(this.env);
      const input = `Instruct: ${QUERY_INSTRUCTION}\nQuery: ${bounded(query)}`;
      const embedding = await context.getEmbeddingFor(input);
      return normalizeMatryoshkaVector(embedding.vector);
    });
  }
}

export function createBuiltinEmbeddings(env: Env): BuiltinEmbeddings {
  return new BuiltinEmbeddings(env);
}

/** Test-only reset for the lazy singleton and serialized inference queue. */
export function resetBuiltinEmbeddingRuntimeForTests(
  loader: RuntimeLoader = importLlamaRuntime,
): void {
  runtimeLoader = loader;
  contextPromise = null;
  inferenceTail = Promise.resolve();
}
