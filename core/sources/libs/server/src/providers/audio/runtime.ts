import type { AudioProviderId } from "./ids.js";
import type { AudioProviderSelection } from "./types.js";
import { MINIMAX_TTS_MODELS } from "./vendors/minimax/options.js";

export type AudioRuntimeConfig = {
  provider: AudioProviderId;
  model: string;
};

export function defaultAudioConfig(): AudioRuntimeConfig {
  return {
    provider: "minimax",
    model: MINIMAX_TTS_MODELS[0],
  };
}

export function audioRuntimeConfigToSelection(
  config: AudioRuntimeConfig,
): AudioProviderSelection {
  return {
    id: config.provider,
    model: config.model,
    options: { model: config.model },
  };
}

export function getAudioRuntimeConfig(_env?: unknown): AudioRuntimeConfig {
  return defaultAudioConfig();
}
