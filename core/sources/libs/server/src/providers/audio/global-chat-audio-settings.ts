import type { GlobalGenerationSettingsRepository } from "../../../../domain/src/index.js";
import { requireGlobalGenerationSettingsPersistence } from "../../generation/global-generation-settings-persistence.js";
import { AUDIO_PROVIDER_OPTIONS } from "./specs.js";
import { audioProviderIds, type AudioProviderId } from "./ids.js";
import { hasAudioProviderCredentials } from "./resolve.js";

export type GlobalChatAudioSettingsSnapshot = {
  provider: AudioProviderId;
  updatedAt: Date;
  updatedByUserId: string | null;
  providers: Array<{
    id: AudioProviderId;
    label: string;
    description: string;
    configured: boolean;
  }>;
};

export function parseChatAudioProvider(
  value: string | null | undefined,
): AudioProviderId {
  return value && audioProviderIds.includes(value as AudioProviderId)
    ? (value as AudioProviderId)
    : "minimax";
}

function assertProvider(value: string): asserts value is AudioProviderId {
  if (!audioProviderIds.includes(value as AudioProviderId)) {
    throw new RangeError(
      `chatAudioProvider must be one of: ${audioProviderIds.join(", ")}`,
    );
  }
}

function providerCatalog() {
  return AUDIO_PROVIDER_OPTIONS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    description: provider.description ?? "",
    configured: hasAudioProviderCredentials(provider.id),
  }));
}

export async function getGlobalChatAudioSettingsSnapshot(
  store: GlobalGenerationSettingsRepository = requireGlobalGenerationSettingsPersistence(),
): Promise<GlobalChatAudioSettingsSnapshot> {
  const row = await store.get();
  return {
    provider: parseChatAudioProvider(row.chatAudioProvider),
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
    providers: providerCatalog(),
  };
}

export async function updateGlobalChatAudioSettings(
  store: GlobalGenerationSettingsRepository,
  provider: AudioProviderId,
  updatedByUserId: string,
): Promise<GlobalChatAudioSettingsSnapshot> {
  assertProvider(provider);
  if (!hasAudioProviderCredentials(provider)) {
    const envHint =
      provider === "minimax"
        ? "MINIMAX_API_KEY and MINIMAX_GROUP_ID"
        : provider === "doubao"
          ? "DOUBAO_SPEECH_API_KEY"
          : provider === "qwen"
            ? "DASHSCOPE_API_KEY"
            : "CARTESIA_API_KEY";
    throw new Error(
      `${envHint} is not configured. Add it in .env before selecting ${provider} chat audio.`,
    );
  }
  await store.update({ chatAudioProvider: provider, updatedByUserId });
  return getGlobalChatAudioSettingsSnapshot(store);
}
