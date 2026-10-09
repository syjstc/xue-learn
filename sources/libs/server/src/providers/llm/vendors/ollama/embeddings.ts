import { OllamaEmbeddings } from "@langchain/ollama";
import type { Env } from "../../../../env.js";
import { OLLAMA_EMBEDDING_MODELS } from "./options.js";

export function createOllamaEmbeddings(
  env: Env,
  model: string = OLLAMA_EMBEDDING_MODELS[0],
) {
  return new OllamaEmbeddings({
    model,
    baseUrl: env.OLLAMA_BASE_URL,
  });
}
