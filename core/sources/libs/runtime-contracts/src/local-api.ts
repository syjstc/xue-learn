import { z } from "zod";
import {
  localAudioProviderIds,
  localChatProviderIds,
  localEmbeddingProviderIds,
  localImageProviderIds,
  localSearchProviderIds,
} from "./providers.js";

export const customThinkingProtocols = [
  "none",
  "openai",
  "minimax",
  "deepseek",
  "doubao",
  "bigmodel",
  "qwen",
  "ollama",
] as const;
export const customThinkingProtocolSchema = z.enum(customThinkingProtocols);
export type CustomThinkingProtocol = z.infer<
  typeof customThinkingProtocolSchema
>;

export const customChatEndpointProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(200),
  thinkingProtocol: customThinkingProtocolSchema,
});
export type CustomChatEndpointProfile = z.infer<
  typeof customChatEndpointProfileSchema
>;

export const customChatEndpointsStateSchema = z.object({
  activeProfileId: z.string().uuid().nullable(),
  profiles: z.array(customChatEndpointProfileSchema).max(20),
});
export type CustomChatEndpointsState = z.infer<
  typeof customChatEndpointsStateSchema
>;

export const emptyCustomChatEndpointsState: CustomChatEndpointsState = {
  activeProfileId: null,
  profiles: [],
};

export function parseCustomChatEndpointsState(
  raw: string | null | undefined,
): CustomChatEndpointsState {
  if (!raw?.trim()) return emptyCustomChatEndpointsState;
  try {
    const parsed = customChatEndpointsStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyCustomChatEndpointsState;
  } catch {
    return emptyCustomChatEndpointsState;
  }
}

export const MINIMAX_REASONING_EFFORTS = [
  "low", "medium", "high", "xhigh", "max",
] as const;
export const minimaxReasoningEffortSchema = z.enum(MINIMAX_REASONING_EFFORTS);
export type MinimaxReasoningEffort = z.infer<typeof minimaxReasoningEffortSchema>;

export const localChatThinkingSettingsSchema = z.object({
  minimaxThinkingEnabled: z.boolean(),
  minimaxReasoningEffort: minimaxReasoningEffortSchema.default("max"),
  ollamaThinkingEnabled: z.boolean(),
  deepseekThinkingEnabled: z.boolean(),
  openaiThinkingEnabled: z.boolean(),
  bigmodelThinkingEnabled: z.boolean(),
  qwenThinkingEnabled: z.boolean(),
  doubaoThinkingMode: z.enum(["enabled", "disabled", "auto"]),
  customThinkingProtocol: customThinkingProtocolSchema,
});
export type LocalChatThinkingSettings = z.infer<
  typeof localChatThinkingSettingsSchema
>;

export const defaultLocalChatThinkingSettings: LocalChatThinkingSettings = {
  minimaxThinkingEnabled: false,
  minimaxReasoningEffort: "max",
  ollamaThinkingEnabled: false,
  deepseekThinkingEnabled: false,
  openaiThinkingEnabled: false,
  bigmodelThinkingEnabled: false,
  qwenThinkingEnabled: false,
  doubaoThinkingMode: "disabled",
  customThinkingProtocol: "none",
};

/** Reasoning controls exposed by the ChatGPT subscription Codex catalog. */
export const CODEX_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const codexReasoningEffortSchema = z.enum(CODEX_REASONING_EFFORTS);
export type CodexReasoningEffort = z.infer<typeof codexReasoningEffortSchema>;

/** The subscription catalog is authoritative for GPT-6 reasoning levels. */
export function codexReasoningEffortsForCatalog(
  supported: readonly string[] | undefined,
  modelId?: string,
): CodexReasoningEffort[] {
  const listed = CODEX_REASONING_EFFORTS.filter((effort) =>
    supported?.length ? supported.includes(effort) : true,
  );
  if (modelId?.startsWith("gpt-6-") && supported?.length) return listed;
  // Earlier Codex models accept `none` even when the catalog omits it.
  return listed[0] === "none" ? listed : ["none", ...listed];
}

export function resolveCodexReasoningEffort(input: {
  current?: string | null;
  supported?: readonly string[];
  catalogDefault?: string | null;
  modelId?: string;
}): CodexReasoningEffort {
  const available = codexReasoningEffortsForCatalog(
    input.supported,
    input.modelId,
  );
  if (
    input.current &&
    available.includes(input.current as CodexReasoningEffort)
  ) {
    return input.current as CodexReasoningEffort;
  }
  if (
    input.catalogDefault &&
    available.includes(input.catalogDefault as CodexReasoningEffort)
  ) {
    return input.catalogDefault as CodexReasoningEffort;
  }
  return available.includes("medium") ? "medium" : (available[0] ?? "none");
}

export const codexModelInfoSchema = z.object({
  id: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  defaultReasoningEffort: z.string().trim().min(1).max(40).nullable(),
  supportedReasoningEfforts: z.array(z.string().trim().min(1).max(40)).max(20),
  inputModalities: z.array(z.string()).optional(),
  supportsImageDetailOriginal: z.boolean().optional(),
});
export type CodexModelInfo = z.infer<typeof codexModelInfoSchema>;

export const codexModelCatalogSchema = z.object({
  available: z.boolean(),
  models: z.array(codexModelInfoSchema).max(100),
  fetchedAt: z.number().int().nonnegative().nullable(),
  stale: z.boolean(),
  error: z.string().nullable(),
});
export type CodexModelCatalog = z.infer<typeof codexModelCatalogSchema>;

export const codexUsageWindowSchema = z.object({
  label: z.string().trim().min(1).max(80),
  usedPercent: z.number().finite().min(0).max(100),
  resetAt: z.string().datetime().nullable(),
});
export type CodexUsageWindow = z.infer<typeof codexUsageWindowSchema>;

export const codexUsageSchema = z.object({
  available: z.boolean(),
  checkedAt: z.number().int().nonnegative().nullable(),
  plan: z.string().trim().max(80).nullable(),
  windows: z.array(codexUsageWindowSchema).max(8),
  resetCreditsAvailable: z.number().int().nonnegative().nullable(),
  creditsBalance: z.number().finite().nonnegative().nullable(),
  creditsUnlimited: z.boolean(),
  error: z.string().nullable(),
});
export type CodexUsage = z.infer<typeof codexUsageSchema>;

export const guidedImageModelSettingsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }).strict(),
  z
    .object({
      mode: z.literal("manual"),
      providerId: z.enum(localChatProviderIds),
      model: z.string().trim().min(1).max(200),
    })
    .strict(),
]);
export type GuidedImageModelSettings = z.infer<
  typeof guidedImageModelSettingsSchema
>;

export const localAiModelSettingsSchema = z.object({
  guidedImageModel: guidedImageModelSettingsSchema.optional(),
  chatProvider: z.enum(localChatProviderIds),
  chatModel: z.string().trim().min(1).max(200),
  embeddingProvider: z.enum(localEmbeddingProviderIds),
  embeddingModel: z.string().trim().min(1).max(200).nullable(),
  searchProvider: z.enum(localSearchProviderIds),
  imageProvider: z.enum(localImageProviderIds),
  imageModel: z.string().trim().min(1).max(200).nullable(),
  audioProvider: z.enum(localAudioProviderIds),
  audioModel: z.string().trim().min(1).max(200).nullable(),
  customBaseUrl: z.string().url().nullable(),
  qwenBaseUrl: z.string().url().nullable().optional(),
  customEmbeddingBaseUrl: z.string().url().nullable(),
  configuredProviders: z.array(z.enum(localChatProviderIds)),
  // Default so a mid-upgrade sidecar/UI never 500s when the field is absent.
  customChatEndpoints: customChatEndpointsStateSchema.default(
    emptyCustomChatEndpointsState,
  ),
  ...localChatThinkingSettingsSchema.shape,
  codexReasoningEffort: codexReasoningEffortSchema.optional(),
});
export type LocalAiModelSettings = z.infer<typeof localAiModelSettingsSchema>;

export const localAiModelSettingsPatchSchema = z.discriminatedUnion(
  "capability",
  [
    z
      .object({
        capability: z.literal("guided_image"),
        settings: guidedImageModelSettingsSchema,
      })
      .strict(),
    z
      .object({
        capability: z.literal("chat"),
        providerId: z.enum(localChatProviderIds),
        model: z.string().trim().min(1).max(200),
        minimaxThinkingEnabled: z.boolean().optional(),
        minimaxReasoningEffort: minimaxReasoningEffortSchema.optional(),
        ollamaThinkingEnabled: z.boolean().optional(),
        deepseekThinkingEnabled: z.boolean().optional(),
        openaiThinkingEnabled: z.boolean().optional(),
        codexReasoningEffort: codexReasoningEffortSchema.optional(),
        bigmodelThinkingEnabled: z.boolean().optional(),
        qwenThinkingEnabled: z.boolean().optional(),
        doubaoThinkingMode: z.enum(["enabled", "disabled", "auto"]).optional(),
        customThinkingProtocol: customThinkingProtocolSchema.optional(),
        customChatProfileId: z.string().uuid().optional(),
        customChatProfileName: z.string().trim().min(1).max(80).optional(),
      })
      .strict(),
    z
      .object({
        capability: z.literal("embedding"),
        providerId: z.enum(localEmbeddingProviderIds).exclude(["none"]),
        model: z.string().trim().min(1).max(200),
      })
      .strict(),
    z
      .object({
        capability: z.literal("search"),
        providerId: z.enum(localSearchProviderIds).exclude(["none"]),
      })
      .strict(),
    z
      .object({
        capability: z.literal("image"),
        providerId: z.enum(localImageProviderIds),
      })
      .strict(),
    z
      .object({
        capability: z.literal("audio"),
        providerId: z.enum(localAudioProviderIds),
        model: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
  ],
);
export type LocalAiModelSettingsPatch = z.infer<
  typeof localAiModelSettingsPatchSchema
>;

export const customChatEndpointUpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(200),
    thinkingProtocol: customThinkingProtocolSchema,
    activate: z.boolean().optional(),
  })
  .strict();
export type CustomChatEndpointUpsert = z.infer<
  typeof customChatEndpointUpsertSchema
>;

export const customChatEndpointDeleteSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
export type CustomChatEndpointDelete = z.infer<
  typeof customChatEndpointDeleteSchema
>;

export const customChatEndpointActivateSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
export type CustomChatEndpointActivate = z.infer<
  typeof customChatEndpointActivateSchema
>;

export const localRuntimeSettingsSchema = z.object({
  chatProvider: z.enum(localChatProviderIds).nullable(),
  chatModel: z.string().min(1).nullable(),
  embeddingProvider: z.enum(localEmbeddingProviderIds),
  embeddingModel: z.string().min(1).nullable(),
  searchProvider: z.enum(localSearchProviderIds),
  imageProvider: z.enum(localImageProviderIds),
  imageModel: z.string().min(1).nullable().default(null),
  audioProvider: z.enum(localAudioProviderIds),
  audioModel: z.string().min(1).nullable().default(null),
  providerBaseUrls: z.record(z.string(), z.string().url()),
  contentVerificationMode: z.enum(["off", "shadow", "enforce"]),
  disabledMaterialComponentTypes: z.array(z.string()),
  updatedAt: z.number().int().nonnegative(),
});
export type LocalRuntimeSettings = z.infer<typeof localRuntimeSettingsSchema>;

export const localVectorReindexStatusSchema = z.object({
  status: z.enum([
    "no_chunks",
    "lexical_only",
    "queued",
    "building",
    "published",
    "failed",
  ]),
  lexicalChunks: z.number().int().nonnegative(),
  indexedVectors: z.number().int().nonnegative(),
  vectorAvailable: z.boolean(),
  providerId: z.enum(localEmbeddingProviderIds),
  model: z.string().min(1).nullable(),
  generationId: z.string().min(1).nullable(),
  jobId: z.string().min(1).nullable(),
  attempt: z.number().int().nonnegative(),
  error: z.string().min(1).nullable(),
  updatedAt: z.number().int().nonnegative(),
});
export type LocalVectorReindexStatus = z.infer<
  typeof localVectorReindexStatusSchema
>;

export const tavilyUsageCodes = [
  "ok",
  "missing_credentials",
  "unauthorized",
  "unreachable",
  "provider_error",
] as const;
export const tavilyUsageCodeSchema = z.enum(tavilyUsageCodes);
export type TavilyUsageCode = z.infer<typeof tavilyUsageCodeSchema>;

export const tavilyUsageSchema = z.object({
  available: z.boolean(),
  code: tavilyUsageCodeSchema,
  message: z.string(),
  checkedAt: z.number().int().nonnegative(),
  plan: z.string().min(1).nullable(),
  planUsage: z.number().int().nonnegative().nullable(),
  planLimit: z.number().int().nonnegative().nullable(),
  paygoUsage: z.number().int().nonnegative().nullable(),
  paygoLimit: z.number().int().nonnegative().nullable(),
  keyUsage: z.number().int().nonnegative().nullable(),
  keyLimit: z.number().int().nonnegative().nullable(),
  searchUsage: z.number().int().nonnegative().nullable(),
  extractUsage: z.number().int().nonnegative().nullable(),
});
export type TavilyUsage = z.infer<typeof tavilyUsageSchema>;

export const localRoutePolicy = Object.freeze({
  forbiddenPrefixes: [
    "/api/auth",
    "/api/email",
    "/api/credits",
    "/api/billing",
    "/api/admin",
    "/api/public-courses",
    "/api/catalog",
    "/api/sharing",
    "/api/moderation",
    "/api/analytics",
    "/api/publication",
    "/api/mobile/purchases",
  ],
  forbiddenExact: ["/api/agenda/push-token", "/api/product-updates"],
});
