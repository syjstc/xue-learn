import type {
  EmbeddingProviderId,
  LlmProviderId,
} from "../../env.js";
import { hostedLlmProviderIds } from "../../env.js";
import type { ProviderSpec } from "../core/types.js";
import type { LlmProvider, LlmProviderOptions } from "./types.js";
import { deepseekLlmSpec } from "./vendors/deepseek/spec.js";
import { customLlmSpec } from "./vendors/custom/spec.js";
import { bigmodelLlmSpec } from "./vendors/bigmodel/spec.js";
import { doubaoLlmSpec } from "./vendors/doubao/spec.js";
import { fireworksLlmSpec } from "./vendors/fireworks/spec.js";
import { minimaxLlmSpec } from "./vendors/minimax/spec.js";
import { ollamaLlmSpec } from "./vendors/ollama/spec.js";
import { openAiLlmSpec } from "./vendors/openai/spec.js";
import { BIGMODEL_EMBEDDING_MODELS } from "./vendors/bigmodel/options.js";
import { OLLAMA_EMBEDDING_MODELS } from "./vendors/ollama/options.js";
import { OPENAI_EMBEDDING_MODELS } from "./vendors/openai/options.js";
import { MINIMAX_EMBEDDING_MODELS } from "./vendors/minimax/options.js";
import { BUILTIN_EMBEDDING_MODEL_ID } from "../../../../runtime-contracts/src/index.js";
import { codexLlmSpec } from "./vendors/codex/spec.js";

export type LlmProviderSpec = ProviderSpec<
  LlmProviderId,
  LlmProvider,
  LlmProviderOptions
>;

/** Active learner-selectable chat providers. Qwen's dormant adapter stays under vendors/qwen. */
export const LLM_PROVIDER_SPECS: readonly LlmProviderSpec[] = [
  customLlmSpec as LlmProviderSpec,
  minimaxLlmSpec as LlmProviderSpec,
  openAiLlmSpec as LlmProviderSpec,
  deepseekLlmSpec as LlmProviderSpec,
  fireworksLlmSpec as LlmProviderSpec,
  doubaoLlmSpec as LlmProviderSpec,
  bigmodelLlmSpec as LlmProviderSpec,
  ollamaLlmSpec as LlmProviderSpec,
  codexLlmSpec as LlmProviderSpec,
];

export type LlmProviderOption = {
  id: LlmProviderId;
  label: string;
  description?: string;
  models: string[];
};

/** One shared hosted catalog for Web, RN, and hosted generation settings. */
export const LLM_PROVIDER_OPTIONS: LlmProviderOption[] =
  LLM_PROVIDER_SPECS.filter(
    (spec): spec is LlmProviderSpec =>
      Boolean(spec) &&
      (hostedLlmProviderIds as readonly string[]).includes(spec.id),
  ).map((spec) => ({
    id: spec.id,
    label: spec.id === "deepseek" ? "DeepSeek Flash" : spec.label,
    description: spec.description,
    models: spec.models,
  }));

export type EmbeddingProviderOption = {
  id: EmbeddingProviderId;
  label: string;
  models: string[];
};

/** Server-fixed embedding catalog; learners cannot switch providers. */
export const EMBEDDING_PROVIDER_OPTIONS: EmbeddingProviderOption[] = [
  {
    id: "builtin",
    label: "Qwen3 Embedding · Local",
    models: [BUILTIN_EMBEDDING_MODEL_ID],
  },
  {
    id: "custom_embedding",
    label: "OpenAI-compatible embeddings",
    models: [],
  },
  {
    id: "minimax",
    label: "MiniMax",
    models: [...MINIMAX_EMBEDDING_MODELS],
  },
  {
    id: "openai",
    label: "OpenAI",
    models: [...OPENAI_EMBEDDING_MODELS],
  },
  {
    id: "bigmodel",
    label: "BigModel",
    models: [...BIGMODEL_EMBEDDING_MODELS],
  },
  {
    id: "ollama",
    label: "Ollama",
    models: [...OLLAMA_EMBEDDING_MODELS],
  },
];
