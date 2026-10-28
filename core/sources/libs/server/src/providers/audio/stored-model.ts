import { QWEN_AUDIO_TTS_PLUS_MODEL } from "../../audio/qwen-audio-tts.js";
import type { AudioProviderId } from "./ids.js";
import type { AudioProviderSelection } from "./types.js";
import { AUDIO_PROVIDER_OPTIONS } from "./specs.js";

export const CHAT_AUDIO_MODEL_PREF_KEY = "chatAudioModel";

export function parseClientPreferencesJson(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export function chatAudioModelFromPreferences(
  raw: string | null | undefined,
): string | null {
  const value = parseClientPreferencesJson(raw)[CHAT_AUDIO_MODEL_PREF_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveAudioModelForProvider(
  provider: AudioProviderId | "none",
  stored?: string | null,
): string | null {
  if (provider === "none") return null;
  const models =
    AUDIO_PROVIDER_OPTIONS.find((item) => item.id === provider)?.models ?? [];
  if (stored && models.includes(stored)) return stored;
  return models[0] ?? null;
}

export function audioSelectionForProvider(
  provider: AudioProviderId,
  preferencesJson?: string | null,
): AudioProviderSelection {
  const model = resolveAudioModelForProvider(
    provider,
    chatAudioModelFromPreferences(preferencesJson),
  );
  return {
    id: provider,
    ...(model ? { model, options: { model } } : {}),
  };
}

export function qwenStudioVoiceForModel(model: string): "qwen" | "qwenPlus" {
  return model === QWEN_AUDIO_TTS_PLUS_MODEL ? "qwenPlus" : "qwen";
}
