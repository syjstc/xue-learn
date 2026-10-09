import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";

export type MiniMaxEmbeddingsParams = EmbeddingsParams & {
  model?: string;
  apiKey: string;
  groupId: string;
  endpointUrl: string;
  /** Max texts per API request (MiniMax "blocks" limit). */
  batchSize?: number;
};

type MiniMaxEmbedResponse = {
  vectors?: number[][];
  base_resp?: { status_code: number; status_msg?: string };
};

/**
 * MiniMax embo-01 embeddings (non–OpenAI-compatible API).
 * @see https://platform.minimaxi.com/document/guides_embedding
 */
export class MiniMaxEmbeddings extends Embeddings {
  private readonly model: string;
  private readonly apiKey: string;
  private readonly groupId: string;
  private readonly endpointUrl: string;
  private readonly batchSize: number;

  constructor(params: MiniMaxEmbeddingsParams) {
    super(params);
    this.model = params.model ?? "embo-01";
    this.apiKey = params.apiKey;
    this.groupId = params.groupId;
    this.endpointUrl = params.endpointUrl;
    this.batchSize = Math.max(1, params.batchSize ?? 32);
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) return [];
    const vectors: number[][] = [];
    for (let i = 0; i < documents.length; i += this.batchSize) {
      const batch = documents.slice(i, i + this.batchSize);
      vectors.push(...(await this.embed(batch, "db")));
    }
    return vectors;
  }

  async embedQuery(document: string): Promise<number[]> {
    const [vector] = await this.embed([document], "query");
    return vector;
  }

  private async embed(
    texts: string[],
    type: "db" | "query",
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    const url = new URL(this.endpointUrl);
    url.searchParams.set("GroupId", this.groupId);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        type,
        texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `MiniMax embeddings HTTP ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const parsed = (await response.json()) as MiniMaxEmbedResponse;
    const code = parsed.base_resp?.status_code;
    if (code !== undefined && code !== 0) {
      throw new Error(
        `MiniMax embeddings error: ${JSON.stringify(parsed.base_resp)}`,
      );
    }

    if (!parsed.vectors?.length) {
      throw new Error("MiniMax embeddings returned no vectors");
    }

    return parsed.vectors;
  }
}
