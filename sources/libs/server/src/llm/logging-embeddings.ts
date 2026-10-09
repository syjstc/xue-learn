import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { beginLlmRequestLog } from "./logger.js";

export class LoggingEmbeddings extends Embeddings {
  private readonly inner: Embeddings;
  private readonly operationPrefix: string;

  constructor(
    inner: Embeddings,
    params?: EmbeddingsParams & { operationPrefix?: string },
  ) {
    super(params ?? {});
    this.inner = inner;
    this.operationPrefix = params?.operationPrefix ?? "embedding";
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const started = Date.now();
    const request = {
      mode: "documents" as const,
      textCount: documents.length,
      totalChars: documents.reduce((n, t) => n + t.length, 0),
      samples: documents.slice(0, 3).map((t) => t.slice(0, 200)),
    };

    const logHandle = await beginLlmRequestLog({
      operation: `${this.operationPrefix}.embedDocuments`,
      kind: "embedding",
      request,
    });

    try {
      const vectors = await this.inner.embedDocuments(documents);
      const durationMs = Date.now() - started;
      await logHandle?.finish({
        status: "success",
        durationMs,
        response: {
          vectorCount: vectors.length,
          dimensions: vectors[0]?.length ?? 0,
        },
      });
      return vectors;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logHandle?.finish({
        status: "error",
        durationMs: Date.now() - started,
        error: message,
      });
      throw err;
    }
  }

  async embedQuery(document: string): Promise<number[]> {
    const started = Date.now();
    const request = {
      mode: "query" as const,
      textLength: document.length,
      textPreview: document.slice(0, 500),
    };

    const logHandle = await beginLlmRequestLog({
      operation: `${this.operationPrefix}.embedQuery`,
      kind: "embedding",
      request,
    });

    try {
      const vector = await this.inner.embedQuery(document);
      const durationMs = Date.now() - started;
      await logHandle?.finish({
        status: "success",
        durationMs,
        response: {
          dimensions: vector.length,
        },
      });
      return vector;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logHandle?.finish({
        status: "error",
        durationMs: Date.now() - started,
        error: message,
      });
      throw err;
    }
  }
}
