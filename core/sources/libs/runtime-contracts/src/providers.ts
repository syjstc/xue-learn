import { z } from "zod";

export const localChatProviderIds = [
  "minimax",
  "openai",
  "deepseek",
  "fireworks",
  "doubao",
  "bigmodel",
  "ollama",
  "custom",
  "codex",
] as const;
export const localSearchProviderIds = [
  "none",
  "tavily",
  "doubao",
  "anysearch",
] as const;
export const localEmbeddingProviderIds = [
  "none",
  "builtin",
  "ollama",
  "custom_embedding",
] as const;
export const localImageProviderIds = [
  "none",
  "minimax",
  "apimart",
  "doubao",
  "krill",
  "codex",
] as const;
export const localAudioProviderIds = [
  "none",
  "minimax",
  "doubao",
  "qwen",
  "cartesia",
] as const;
export const localProviderCapabilityIds = [
  "chat",
  "embedding",
  "search",
  "image",
  "audio",
] as const;

export const localProviderIdSchema = z.enum([
  ...localChatProviderIds,
  "qwen",
  "cartesia",
  "tavily",
  "anysearch",
  "builtin",
  "custom_embedding",
  "apimart",
  "krill",
]);
export type LocalProviderId = z.infer<typeof localProviderIdSchema>;

export const credentialFieldsByProvider = {
  builtin: [],
  custom: ["apiKey", "baseUrl"],
  custom_embedding: ["apiKey", "baseUrl"],
  minimax: ["apiKey", "groupId", "embeddingApiKey"],
  openai: ["apiKey"],
  codex: [],
  deepseek: ["apiKey"],
  fireworks: ["apiKey"],
  doubao: ["apiKey", "searchApiKey", "speechApiKey"],
  ollama: [],
  tavily: ["apiKey"],
  anysearch: ["apiKey"],
  bigmodel: ["apiKey"],
  qwen: ["apiKey", "baseUrl"],
  cartesia: ["apiKey"],
  apimart: ["apiKey"],
  krill: ["apiKey"],
} as const satisfies Record<LocalProviderId, readonly string[]>;

/** Vault key for one saved OpenAI-compatible chat endpoint profile. */
export const CUSTOM_CHAT_PROFILE_CREDENTIAL_PREFIX = "custom:" as const;
const CUSTOM_CHAT_PROFILE_CREDENTIAL_ID_RE =
  /^custom:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const customChatProfileCredentialProviderIdSchema = z
  .string()
  .regex(CUSTOM_CHAT_PROFILE_CREDENTIAL_ID_RE);
export type CustomChatProfileCredentialProviderId = z.infer<
  typeof customChatProfileCredentialProviderIdSchema
>;

export const credentialProviderKeySchema = z.union([
  localProviderIdSchema,
  customChatProfileCredentialProviderIdSchema,
]);
export type CredentialProviderKey = z.infer<typeof credentialProviderKeySchema>;

export function customChatProfileCredentialProviderId(
  profileId: string,
): CustomChatProfileCredentialProviderId {
  return customChatProfileCredentialProviderIdSchema.parse(
    `${CUSTOM_CHAT_PROFILE_CREDENTIAL_PREFIX}${profileId}`,
  );
}

export function parseCustomChatProfileCredentialProviderId(
  providerId: string,
): string | null {
  const match = CUSTOM_CHAT_PROFILE_CREDENTIAL_ID_RE.exec(providerId);
  return match?.[1]?.toLowerCase() ?? null;
}

export function credentialFieldsForProviderKey(
  providerId: string,
): readonly string[] {
  const profileId = parseCustomChatProfileCredentialProviderId(providerId);
  if (profileId) return credentialFieldsByProvider.custom;
  const parsed = localProviderIdSchema.safeParse(providerId);
  if (!parsed.success) return [];
  return credentialFieldsByProvider[parsed.data];
}

export const localProviderBaseUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Endpoint URL must use HTTP or HTTPS");

/** Invalid legacy vault values are ignored at sidecar startup, not fatal. */
export function validLocalProviderBaseUrl(
  value: string | null | undefined,
): string | undefined {
  const parsed = localProviderBaseUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Curated GGUF model downloaded on demand by desktop-local. */
export const BUILTIN_EMBEDDING_MODEL_ID =
  "xuelearn/qwen3-embedding-0.6b-q8-v1" as const;
export const BUILTIN_EMBEDDING_DIMENSIONS = 512;
export const BUILTIN_EMBEDDING_MAX_TOKENS = 8192;

export function isCredentialProviderKey(providerId: string): boolean {
  return (
    localProviderIdSchema.safeParse(providerId).success ||
    Boolean(parseCustomChatProfileCredentialProviderId(providerId))
  );
}

export const localCredentialSnapshotSchema = z
  .record(z.string(), z.record(z.string(), z.string().min(1)))
  .superRefine((credentials, context) => {
    for (const [rawProviderId, values] of Object.entries(credentials)) {
      if (!isCredentialProviderKey(rawProviderId)) {
        context.addIssue({
          code: "custom",
          path: [rawProviderId],
          message: "Unsupported local provider",
        });
        continue;
      }
      const allowedFields = new Set<string>(
        credentialFieldsForProviderKey(rawProviderId),
      );
      for (const field of Object.keys(values)) {
        if (!allowedFields.has(field)) {
          context.addIssue({
            code: "custom",
            path: [rawProviderId, field],
            message: "Unsupported credential field",
          });
        }
      }
    }
  });
export type LocalCredentialSnapshot = z.infer<
  typeof localCredentialSnapshotSchema
>;

export const localChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

export const localChatCompletionRequestSchema = z.object({
  messages: z.array(localChatMessageSchema).min(1).max(64),
  maxTokens: z.number().int().min(1).max(16_384).optional(),
  operationKey: z.string().trim().min(1).max(160).optional(),
  /** Optional goal scope for the local goal-overridden teaching persona. */
  goalId: z.string().trim().min(1).optional(),
});
export type LocalChatCompletionRequest = z.infer<
  typeof localChatCompletionRequestSchema
>;

export const localChatCompletionResultSchema = z.object({
  providerId: z.enum(localChatProviderIds),
  model: z.string().min(1),
  content: z.string(),
});
export type LocalChatCompletionResult = z.infer<
  typeof localChatCompletionResultSchema
>;

export const localChatConnectionTestRequestSchema = z.object({
  providerId: z.enum(localChatProviderIds),
  model: z.string().min(1).optional(),
});
export type LocalChatConnectionTestRequest = z.infer<
  typeof localChatConnectionTestRequestSchema
>;

export const localProviderConnectionResultSchema = z.object({
  providerId: z.enum(localChatProviderIds),
  model: z.string().min(1),
  healthy: z.boolean(),
  checkedAt: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  code: z.enum([
    "ok",
    "missing_credentials",
    "invalid_configuration",
    "unauthorized",
    "unreachable",
    "provider_error",
    "invalid_response",
  ]),
  message: z.string().min(1),
});
export type LocalProviderConnectionResult = z.infer<
  typeof localProviderConnectionResultSchema
>;

export const localProviderConnectionTestRequestSchema = z.discriminatedUnion(
  "capability",
  [
    z.object({
      capability: z.literal("embedding"),
      providerId: z.enum(localEmbeddingProviderIds).exclude(["none"]),
      model: z.string().trim().min(1).optional(),
    }),
    z.object({
      capability: z.literal("search"),
      providerId: z.enum(localSearchProviderIds).exclude(["none"]),
    }),
    z.object({
      capability: z.literal("image"),
      providerId: z.enum(localImageProviderIds).exclude(["none"]),
      model: z.string().trim().min(1).optional(),
    }),
    z.object({
      capability: z.literal("audio"),
      providerId: z.enum(localAudioProviderIds).exclude(["none"]),
      model: z.string().trim().min(1).optional(),
    }),
  ],
);
export type LocalProviderConnectionTestRequest = z.infer<
  typeof localProviderConnectionTestRequestSchema
>;

export const localCapabilityConnectionResultSchema = z.object({
  capability: z.enum(localProviderCapabilityIds),
  providerId: localProviderIdSchema,
  model: z.string().min(1).nullable(),
  healthy: z.boolean(),
  checkedAt: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  code: localProviderConnectionResultSchema.shape.code,
  message: z.string().min(1),
});
export type LocalCapabilityConnectionResult = z.infer<
  typeof localCapabilityConnectionResultSchema
>;

export const localOperationRouteSchema = z.object({
  operationKey: z.string().trim().min(1).max(160),
  providerId: z.enum(localChatProviderIds),
  model: z.string().trim().min(1).max(200),
  updatedAt: z.number().int().nonnegative(),
});
export type LocalOperationRoute = z.infer<typeof localOperationRouteSchema>;

export const localOperationRouteMutationSchema = localOperationRouteSchema
  .omit({ operationKey: true, updatedAt: true })
  .strict();
export type LocalOperationRouteMutation = z.infer<
  typeof localOperationRouteMutationSchema
>;

export const credentialStatusSchema = z.object({
  providerId: credentialProviderKeySchema,
  configuredFields: z.array(z.string()),
  healthy: z.boolean().nullable(),
  lastCheckedAt: z.number().int().nonnegative().nullable(),
});
export type CredentialStatus = z.infer<typeof credentialStatusSchema>;

export const credentialMutationSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("set"),
      providerId: credentialProviderKeySchema,
      values: z.record(z.string(), z.string().min(1)),
    }),
    z.object({
      action: z.literal("delete"),
      providerId: credentialProviderKeySchema,
      fields: z.array(z.string().min(1)).min(1),
    }),
  ])
  .superRefine((mutation, context) => {
    if (mutation.action !== "set" || mutation.values.baseUrl === undefined) {
      return;
    }
    const parsed = localProviderBaseUrlSchema.safeParse(
      mutation.values.baseUrl,
    );
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        path: ["values", "baseUrl"],
        message: "Endpoint URL must use HTTP or HTTPS",
      });
    }
  });
export type CredentialMutation = z.infer<typeof credentialMutationSchema>;
