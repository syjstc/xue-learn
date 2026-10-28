export type {
  TtsProvider,
  TtsClip,
  TtsSegmentedTrack,
  TtsRequestOptions,
  AudioProviderOptions,
  AudioProviderSelection,
  ChatNarrationCharTiming,
  ChatNarrationSegment,
  ChatNarrationTrack,
} from "./types.js";

export { audioProviderIds, type AudioProviderId } from "./ids.js";

export {
  AUDIO_PROVIDER_SPECS,
  AUDIO_PROVIDER_OPTIONS,
  type AudioProviderSpec,
  type AudioProviderOption,
} from "./specs.js";

export { AUDIO_PROVIDER_REGISTRY, getAudioProviderSpec } from "./registry.js";
export {
  getAudioRuntimeConfig,
  audioRuntimeConfigToSelection,
  type AudioRuntimeConfig,
} from "./runtime.js";

export {
  resolveAudioProvider,
  getAudioProvider,
  resetAudioProviderCache,
  hasAudioProviderCredentials,
} from "./resolve.js";
export {
  CHAT_AUDIO_MODEL_PREF_KEY,
  audioSelectionForProvider,
  chatAudioModelFromPreferences,
  parseClientPreferencesJson,
  qwenStudioVoiceForModel,
  resolveAudioModelForProvider,
} from "./stored-model.js";

export { createMinimaxTtsProvider } from "./vendors/minimax/provider.js";
export { createDoubaoTtsProvider } from "./vendors/doubao/provider.js";
export { createQwenTtsProvider } from "./vendors/qwen/provider.js";
export { createCartesiaTtsProvider } from "./vendors/cartesia/provider.js";
