import { OpenAIEmbeddings } from "@langchain/openai";
import type { Env } from "../../../../env.js";

/** Desktop-local generic OpenAI-compatible embedding endpoint. */
export function createCustomEmbeddings(env: Env, model: string) {
  return new OpenAIEmbeddings({
    model,
    apiKey: env.CUSTOM_EMBEDDING_API_KEY!,
    configuration: { baseURL: env.CUSTOM_EMBEDDING_BASE_URL! },
  });
}
