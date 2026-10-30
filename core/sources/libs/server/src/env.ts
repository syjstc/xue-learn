import { z } from "zod";

export const llmProviderIds = [
  "custom",
  "minimax",
  "openai",
  "codex",
  "deepseek",
  "fireworks",
  "doubao",
  "bigmodel",
  "qwen",
  "ollama",
] as const;
export type LlmProviderId = (typeof llmProviderIds)[number];

/**
 * Providers enabled by either hosted or desktop-local runtime selection.
 *
 * Qwen remains a known provider so historical pricing/log rows and its dormant
 * DashScope adapter stay readable, but it is hidden from Settings for now and
 * may be re-enabled later.
 */
export const activeLlmProviderIds = [
  "custom",
  "minimax",
  "openai",
  "codex",
  "deepseek",
  "fireworks",
  "doubao",
  "bigmodel",
  "ollama",
] as const satisfies readonly LlmProviderId[];
export type ActiveLlmProviderId = (typeof activeLlmProviderIds)[number];

/** Web and RN share one hosted chat policy; desktop-local keeps its catalog. */
export const HOSTED_LLM_PROVIDER = "deepseek" as const;
export const hostedLlmProviderIds = [
  HOSTED_LLM_PROVIDER,
] as const satisfies readonly LlmProviderId[];

export function isActiveLlmProvider(
  provider: string,
): provider is ActiveLlmProviderId {
  return activeLlmProviderIds.includes(provider as ActiveLlmProviderId);
}

/** Chat-only providers that require a separate embedding backend. */
export function isChatOnlyLlmProvider(provider: LlmProviderId): boolean {
  return (
    provider === "custom" ||
    provider === "deepseek" ||
    provider === "fireworks" ||
    provider === "doubao" ||
    provider === "qwen"
  );
}

export const embeddingProviderIds = [
  "builtin",
  "custom_embedding",
  "minimax",
  "openai",
  "bigmodel",
  "ollama",
] as const;
export type EmbeddingProviderId = (typeof embeddingProviderIds)[number];

import {
  imageProviderIds,
  type ImageProviderId,
} from "./images/provider-ids.js";
import type { SearchProviderId } from "./search/provider-ids.js";

export { imageProviderIds };
export type { ImageProviderId };

const envSchema = z.object({
  // Desktop-local downloaded GGUF embedding model. Hosted services never set it.
  XUELEARN_LOCAL_EMBEDDING_MODEL_ROOT: z.string().optional(),
  XUELEARN_LOCAL_EMBEDDING_MODEL_ERROR: z.string().optional(),
  // Desktop-local generic OpenAI-compatible chat endpoint.
  CUSTOM_OPENAI_API_KEY: z.string().optional(),
  CUSTOM_OPENAI_BASE_URL: z.string().url().optional(),
  // Desktop-local generic OpenAI-compatible embedding endpoint.
  CUSTOM_EMBEDDING_API_KEY: z.string().optional(),
  CUSTOM_EMBEDDING_BASE_URL: z.string().url().optional(),

  // MiniMax (OpenAI-compatible chat + native embeddings + TTS)
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_BASE_URL: z.string().default("https://api.minimaxi.com/v1"),
  MINIMAX_GROUP_ID: z.string().optional(),
  MINIMAX_EMBEDDING_API_KEY: z.string().optional(),
  MINIMAX_EMBEDDING_URL: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),

  // BigModel / Zhipu AI (OpenAI-compatible chat + embeddings)
  BIGMODEL_API_KEY: z.string().optional(),
  BIGMODEL_BASE_URL: z.string().default("https://open.bigmodel.cn/api/paas/v4"),

  // DeepSeek (OpenAI-compatible chat only)
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_STRICT_BASE_URL: z.string().default("https://api.deepseek.com/beta"),
  DEEPSEEK_STRICT_STRUCTURED_OUTPUT_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || typeof value === "boolean") {
        return value ?? true;
      }
      return !["false", "0", "no", "off"].includes(value.toLowerCase());
    }),

  // Fireworks (OpenAI-compatible chat only)
  FIREWORKS_API_KEY: z.string().optional(),
  FIREWORKS_BASE_URL: z
    .string()
    .default("https://api.fireworks.ai/inference/v1"),

  // Doubao / Volcengine Ark (chat + Seedream image generation)
  DOUBAO_API_KEY: z.string().optional(),
  DOUBAO_BASE_URL: z
    .string()
    .default("https://ark.cn-beijing.volces.com/api/v3"),

  // Qwen / Alibaba Cloud Model Studio DashScope (chat + Qwen-Audio-TTS)
  // Mainland default; override to dashscope-intl / dashscope-us when needed.
  DASHSCOPE_API_KEY: z.string().optional(),
  DASHSCOPE_BASE_URL: z
    .string()
    .default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  /** Optional workspace-root override for Qwen-Audio-TTS HTTP API. */
  DASHSCOPE_AUDIO_BASE_URL: z.string().url().optional(),

  // Cartesia Sonic TTS
  CARTESIA_API_KEY: z.string().optional(),
  CARTESIA_BASE_URL: z.string().url().default("https://api.cartesia.ai"),
  CARTESIA_VERSION: z.string().default("2026-08-14"),

  // Ollama (local chat + embeddings via /api/embed)
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),

  DATABASE_URL: z.string().default("file:./dev.db"),
  TAVILY_API_KEY: z.string().optional(),
  /** 豆包搜索 Global版 API Key (Bearer auth on open.feedcoopapi.com). */
  DOUBAO_SEARCH_API_KEY: z.string().optional(),
  DOUBAO_SEARCH_BASE_URL: z.string().default("https://open.feedcoopapi.com"),
  /** AnySearch MCP API Key (Bearer auth on api.anysearch.com). @see https://anysearch.com/docs */
  ANYSEARCH_API_KEY: z.string().optional(),

  LLM_LOG_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true;
      if (typeof v === "boolean") return v;
      return !["false", "0", "no", "off"].includes(v.toLowerCase());
    }),
  LLM_LOG_MAX_CHARS: z.coerce.number().default(50_000),
  LOG_LEVEL: z.string().default("info"),
  API_LOG_DB_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true;
      if (typeof v === "boolean") return v;
      return !["false", "0", "no", "off"].includes(v.toLowerCase());
    }),
  API_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  BACKEND_ERROR_LOG_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true;
      if (typeof v === "boolean") return v;
      return !["false", "0", "no", "off"].includes(v.toLowerCase());
    }),
  BACKEND_ERROR_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(30),
  BACKEND_ERROR_MAX_GROUPS: z.coerce
    .number()
    .int()
    .min(100)
    .max(100_000)
    .default(5000),
  LLM_LOG_DB_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(30),
  LLM_PAYLOAD_LOG_MODE: z
    .enum(["off", "errors", "sampled", "errors_sampled", "all"])
    .default("errors_sampled"),
  LLM_PAYLOAD_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.01),
  LLM_PAYLOAD_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(7),
  LLM_LOG_PREVIEW_CHARS: z.coerce
    .number()
    .int()
    .min(0)
    .max(50_000)
    .default(50_000),
  LOG_SPOOL_DIR: z.string().default("./data/log-spool"),
  LOG_ARCHIVE_BACKEND: z.enum(["local", "cos", "oss"]).default("local"),
  LOG_DISK_WARNING_PERCENT: z.coerce.number().min(1).max(100).default(80),
  LOG_DISK_CRITICAL_PERCENT: z.coerce.number().min(1).max(100).default(90),
  LOG_RETENTION_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),

  /** Optional webhook for performance alerts (DingTalk / Slack / Discord / custom). */
  ALERT_WEBHOOK_URL: z
    .union([z.string().url(), z.literal("")])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  ALERT_COOLDOWN_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(15),
  ALERT_CHECK_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(60)
    .default(1),
  /** Host memory used % that triggers an alert. */
  ALERT_MEMORY_PERCENT: z.coerce.number().min(1).max(100).default(85),
  /** 1-minute load average divided by CPU count. */
  ALERT_LOAD_PER_CPU: z.coerce.number().min(0.1).max(100).default(1.5),
  /** Requests per minute (1-minute window) that triggers an alert. */
  ALERT_REQUESTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(300),
  /** 5xx rate % over 5 minutes. */
  ALERT_ERROR_RATE_PERCENT: z.coerce.number().min(0.1).max(100).default(5),
  /** Minimum samples in the 5-minute window before error/latency alerts fire. */
  ALERT_ERROR_MIN_SAMPLES: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(20),
  /** p95 latency (ms) over 5 minutes. */
  ALERT_P95_MS: z.coerce.number().int().min(50).max(600_000).default(3000),
  COS_SECRET_ID: z.string().optional(),
  COS_SECRET_KEY: z.string().optional(),
  COS_BUCKET: z.string().optional(),
  COS_REGION: z.string().optional(),
  COS_LOG_PREFIX: z.string().default("llm-payload"),

  /** Public course distribution (separate from log-archive COS). */
  COURSE_COS_SECRET_ID: z.string().optional(),
  COURSE_COS_SECRET_KEY: z.string().optional(),
  COURSE_COS_BUCKET: z.string().optional(),
  COURSE_COS_REGION: z.string().optional(),
  COURSE_COS_PREFIX: z.string().default("courses/v1"),
  PUBLIC_COURSE_CDN_BASE_URL: z.string().optional(),
  /** Private learner-facing generated media (separate from public courses). */
  MEDIA_COS_SECRET_ID: z.string().optional(),
  MEDIA_COS_SECRET_KEY: z.string().optional(),
  MEDIA_COS_BUCKET: z.string().optional(),
  MEDIA_COS_REGION: z.string().optional(),
  MEDIA_COS_PREFIX: z.string().default("chat-audio/v1"),
  DOUBAO_SPEECH_API_KEY: z.string().optional(),
  /** Optional Tencent CDN purge credentials (may reuse COURSE_COS_*). */
  COURSE_CDN_SECRET_ID: z.string().optional(),
  COURSE_CDN_SECRET_KEY: z.string().optional(),
  COURSE_CDN_PURGE_URLS: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true;
      if (typeof v === "boolean") return v;
      return !["false", "0", "no", "off"].includes(v.toLowerCase());
    }),

  /** Texts per embedding API request (MiniMax embo-01 block limit). */
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(256).default(32),
  /** Max RAG chunks stored per single uploaded file. */
  RAG_MAX_CHUNKS_PER_UPLOAD: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(400),
  /** OCR scanned/image PDFs when embedded text extraction is sparse. */
  DOCUMENT_OCR_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true;
      if (typeof v === "boolean") return v;
      return !["false", "0", "no", "off"].includes(v.toLowerCase());
    }),
  /** Tesseract language pack(s), e.g. eng+chi_sim for English and simplified Chinese. */
  DOCUMENT_OCR_LANGUAGES: z.string().default("eng+chi_sim"),
  /** Max PDF pages to OCR per upload (large scans are expensive). */
  DOCUMENT_OCR_MAX_PAGES: z.coerce.number().int().min(1).max(500).default(40),
  /** Parallel LLM streams when batch-generating SQ previews for a goal. */
  BATCH_SQ_PREVIEW_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
  /** Parallel LLM streams when batch-generating learning material for selected units. */
  BATCH_MATERIAL_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
  /** Parallel LLM streams when expanding independent map module stubs. */
  MAP_EXPANSION_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),

  /** Directory for generated unit images (relative to project root). */
  IMAGE_STORAGE_DIR: z.string().default("./data/unit-images"),
  /** Directory for generated unit narration audio (relative to project root). */
  AUDIO_STORAGE_DIR: z.string().default("./data/unit-audio"),

  // APIMart — GPT-Image-2 (async image generation)
  APIMART_API_KEY: z.string().optional(),
  APIMART_BASE_URL: z.string().default("https://api.apimart.ai"),

  // Krill — GPT-Image-2 via OpenAI Images API (视觉创作, not Codex /codex/v1)
  KRILL_API_KEY: z.string().optional(),
  KRILL_IMAGE_BASE_URL: z.string().default("https://api.krill-code.net/v1"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;
let configuredEnvironment: (() => NodeJS.ProcessEnv) | undefined;

/** Host-owned credentials/configuration without writing secrets to process.env.
 * Configure once per server composition; refresh cached provider settings when
 * its underlying snapshot changes. Never expose this source to browser code. */
export function configureEnvSource(source: (() => NodeJS.ProcessEnv) | undefined): void {
  configuredEnvironment = source;
  cached = null;
}

export function getRuntimeEnvironment(): NodeJS.ProcessEnv {
  return configuredEnvironment ? { ...configuredEnvironment() } : { ...process.env };
}

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(getRuntimeEnvironment());
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const custom = parsed.error.issues
      .filter((i) => i.code === "custom")
      .map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Invalid environment: ${JSON.stringify({ ...fieldErrors, custom })}`,
    );
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

function hasEmbeddingConfigured(provider: EmbeddingProviderId): boolean {
  if (provider === "builtin") {
    return getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1";
  }
  if (provider === "openai") {
    return Boolean(getRuntimeEnvironment().OPENAI_API_KEY?.trim());
  }
  if (provider === "custom_embedding") {
    return Boolean(
      getRuntimeEnvironment().CUSTOM_EMBEDDING_API_KEY?.trim() &&
      getRuntimeEnvironment().CUSTOM_EMBEDDING_BASE_URL?.trim(),
    );
  }
  if (provider === "bigmodel") {
    return Boolean(getRuntimeEnvironment().BIGMODEL_API_KEY?.trim());
  }
  if (provider === "ollama") {
    return Boolean(getRuntimeEnvironment().OLLAMA_BASE_URL?.trim());
  }
  return Boolean(
    getRuntimeEnvironment().MINIMAX_API_KEY?.trim() && getRuntimeEnvironment().MINIMAX_GROUP_ID?.trim(),
  );
}

export function hasLlmConfigured(): boolean {
  return activeLlmProviderIds.some((id) => hasProviderCredentials(id));
}

export function hasProviderCredentials(provider: LlmProviderId): boolean {
  switch (provider) {
    case "custom":
      return Boolean(
        getRuntimeEnvironment().CUSTOM_OPENAI_API_KEY?.trim() &&
        getRuntimeEnvironment().CUSTOM_OPENAI_BASE_URL?.trim(),
      );
    case "openai":
      return Boolean(getRuntimeEnvironment().OPENAI_API_KEY?.trim());
    case "codex":
      // Codex subscription credentials are owned by the Electron host. The
      // sidecar receives a short-lived token through its private runtime
      // channel, so there is deliberately no environment credential here.
      return getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1";
    case "deepseek":
      return Boolean(getRuntimeEnvironment().DEEPSEEK_API_KEY?.trim());
    case "fireworks":
      return Boolean(getRuntimeEnvironment().FIREWORKS_API_KEY?.trim());
    case "doubao":
      return Boolean(getRuntimeEnvironment().DOUBAO_API_KEY?.trim());
    case "bigmodel":
      return Boolean(getRuntimeEnvironment().BIGMODEL_API_KEY?.trim());
    case "qwen":
      return Boolean(getRuntimeEnvironment().DASHSCOPE_API_KEY?.trim());
    case "minimax":
      // Current OpenAI-compatible chat authenticates with the API key alone.
      return Boolean(getRuntimeEnvironment().MINIMAX_API_KEY?.trim());
    case "ollama":
      return Boolean(getRuntimeEnvironment().OLLAMA_BASE_URL?.trim());
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export function hasEmbeddingProviderCredentials(
  provider: EmbeddingProviderId,
): boolean {
  return hasEmbeddingConfigured(provider);
}

export function hasTavilyConfigured(): boolean {
  return Boolean(getRuntimeEnvironment().TAVILY_API_KEY?.trim());
}

export function hasDoubaoSearchConfigured(): boolean {
  return Boolean(getRuntimeEnvironment().DOUBAO_SEARCH_API_KEY?.trim());
}

export function hasAnySearchConfigured(): boolean {
  return Boolean(getRuntimeEnvironment().ANYSEARCH_API_KEY?.trim());
}

export function hasSearchProviderCredentials(
  provider: SearchProviderId,
): boolean {
  switch (provider) {
    case "tavily":
      return hasTavilyConfigured();
    case "doubao":
      return hasDoubaoSearchConfigured();
    case "anysearch":
      return hasAnySearchConfigured();
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** @deprecated Use hasLlmConfigured */
export function hasOpenAI(): boolean {
  return Boolean(getRuntimeEnvironment().OPENAI_API_KEY?.trim());
}
