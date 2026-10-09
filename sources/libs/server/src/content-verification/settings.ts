import type { GlobalGenerationSettingsRepository } from "../../../domain/src/index.js";
import { requireGlobalGenerationSettingsPersistence } from "../generation/global-generation-settings-persistence.js";
import {
  getEnv,
  HOSTED_LLM_PROVIDER,
  isActiveLlmProvider,
  type LlmProviderId,
} from "../env.js";
import {
  defaultLlmChatModel,
  getLlmProviderSpec,
  hasLlmProviderCredentials,
  LLM_PROVIDER_OPTIONS,
  type LlmProviderSelection,
} from "../providers/llm/index.js";

export const contentVerificationModes = ["off", "shadow", "enforce"] as const;
export type ContentVerificationMode = (typeof contentVerificationModes)[number];

export type ContentVerificationSettings = {
  mode: ContentVerificationMode;
  provider: LlmProviderId;
  model: string;
  selection: LlmProviderSelection;
  configured: boolean;
  updatedAt: Date;
  updatedByUserId: string | null;
};

function parseMode(value: string): ContentVerificationMode {
  return contentVerificationModes.includes(value as ContentVerificationMode)
    ? (value as ContentVerificationMode)
    : "off";
}

function parseProvider(value: string): LlmProviderId {
  if (process.env.XUELEARN_DESKTOP_LOCAL !== "1") return HOSTED_LLM_PROVIDER;
  return isActiveLlmProvider(value) ? value : "deepseek";
}

function validModel(provider: LlmProviderId, value: string): string {
  const spec = getLlmProviderSpec(provider);
  return spec.models.includes(value) ? value : defaultLlmChatModel(provider);
}

function selection(
  provider: LlmProviderId,
  model: string,
): LlmProviderSelection {
  return {
    id: provider,
    model,
    options: { chatModel: model, routingReasoningMode: "disabled" },
  };
}

export function contentVerificationProviderCatalog() {
  return LLM_PROVIDER_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    description:
      option.description ?? "Independent content verification model.",
    models: option.models,
    configured: hasLlmProviderCredentials(
      selection(option.id, option.models[0] ?? defaultLlmChatModel(option.id)),
      getEnv(),
    ),
  }));
}

export async function getContentVerificationSettings(
  client: GlobalGenerationSettingsRepository = requireGlobalGenerationSettingsPersistence(),
): Promise<ContentVerificationSettings> {
  const row = await client.get();
  const provider = parseProvider(row.contentVerificationProvider);
  const model = validModel(provider, row.contentVerificationModel);
  const providerSelection = selection(provider, model);
  return {
    mode: parseMode(row.contentVerificationMode),
    provider,
    model,
    selection: providerSelection,
    configured: hasLlmProviderCredentials(providerSelection, getEnv()),
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}

export async function updateContentVerificationSettings(
  client: GlobalGenerationSettingsRepository,
  patch: {
    mode?: ContentVerificationMode;
    provider?: LlmProviderId;
    model?: string;
  },
  updatedByUserId: string,
): Promise<ContentVerificationSettings> {
  const current = await getContentVerificationSettings(client);
  const provider = patch.provider ?? current.provider;
  if (
    !isActiveLlmProvider(provider) ||
    (process.env.XUELEARN_DESKTOP_LOCAL !== "1" &&
      provider !== HOSTED_LLM_PROVIDER)
  )
    throw new RangeError("Invalid verification provider");
  const model =
    patch.model ??
    (patch.provider ? defaultLlmChatModel(provider) : current.model);
  if (!getLlmProviderSpec(provider).models.includes(model)) {
    throw new RangeError(`Model ${model} is not registered for ${provider}`);
  }
  if (patch.mode && !contentVerificationModes.includes(patch.mode)) {
    throw new RangeError("Invalid verification mode");
  }
  const providerSelection = selection(provider, model);
  if (
    (patch.mode ?? current.mode) !== "off" &&
    !hasLlmProviderCredentials(providerSelection, getEnv())
  ) {
    throw new Error(`Credentials are not configured for ${provider}`);
  }
  await client.update({
    contentVerificationMode: patch.mode ?? current.mode,
    contentVerificationProvider: provider,
    contentVerificationModel: model,
    updatedByUserId,
  });
  return getContentVerificationSettings(client);
}
