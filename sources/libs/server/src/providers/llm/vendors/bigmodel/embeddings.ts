import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { Env } from "../../../../env.js";
import {
  BIGMODEL_EMBEDDING_MAX_INPUT_CHARS,
  BIGMODEL_EMBEDDING_MODELS,
} from "./options.js";

export { BIGMODEL_EMBEDDING_MAX_INPUT_CHARS };

const DEFAULT_BIGMODEL_EMBEDDING_MODEL = BIGMODEL_EMBEDDING_MODELS[0];

/**
 * Caps each input under BigModel embedding-3's 3072-token limit.
 * Uses a conservative character budget so CJK-heavy text does not 400.
 */
export function truncateBigModelEmbeddingInput(
  text: string,
  maxChars: number = BIGMODEL_EMBEDDING_MAX_INPUT_CHARS,
): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

class TruncatingEmbeddings extends Embeddings {
  private readonly inner: Embeddings;
  private readonly maxChars: number;

  constructor(
    inner: Embeddings,
    params?: EmbeddingsParams & { maxChars?: number },
  ) {
    super(params ?? {});
    this.inner = inner;
    this.maxChars = params?.maxChars ?? BIGMODEL_EMBEDDING_MAX_INPUT_CHARS;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return this.inner.embedDocuments(
      documents.map((document) =>
        truncateBigModelEmbeddingInput(document, this.maxChars),
      ),
    );
  }

  async embedQuery(document: string): Promise<number[]> {
    return this.inner.embedQuery(
      truncateBigModelEmbeddingInput(document, this.maxChars),
    );
  }
}

export function createBigModelEmbeddings(
  env: Env,
  model: string = DEFAULT_BIGMODEL_EMBEDDING_MODEL,
) {
  const inner = new OpenAIEmbeddings({
    model,
    apiKey: env.BIGMODEL_API_KEY!,
    batchSize: Math.min(env.EMBEDDING_BATCH_SIZE, 64),
    configuration: {
      baseURL: env.BIGMODEL_BASE_URL,
    },
  });
  return new TruncatingEmbeddings(inner);
}
