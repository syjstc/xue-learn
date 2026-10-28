import type { AudioProviderId } from "./ids.js";
import type { ProviderSpec } from "../core/types.js";
import type { AudioProviderOptions, TtsProvider } from "./types.js";
import { minimaxAudioSpec } from "./vendors/minimax/spec.js";
import { doubaoAudioSpec } from "./vendors/doubao/spec.js";
import { qwenAudioSpec } from "./vendors/qwen/spec.js";
import { cartesiaAudioSpec } from "./vendors/cartesia/spec.js";

export type AudioProviderSpec = ProviderSpec<
  AudioProviderId,
  TtsProvider,
  AudioProviderOptions
>;

export const AUDIO_PROVIDER_SPECS: readonly AudioProviderSpec[] = [
  minimaxAudioSpec as AudioProviderSpec,
  doubaoAudioSpec as AudioProviderSpec,
  qwenAudioSpec as AudioProviderSpec,
  cartesiaAudioSpec as AudioProviderSpec,
];

export type AudioProviderOption = {
  id: AudioProviderId;
  label: string;
  description?: string;
  models: string[];
};

export const AUDIO_PROVIDER_OPTIONS: AudioProviderOption[] =
  AUDIO_PROVIDER_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    description: spec.description,
    models: spec.models,
  }));
