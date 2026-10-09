import type { ProviderSpec } from "../../../core/types.js";
import type {
  AudioProviderOptions,
  AudioProviderSelection,
  TtsProvider,
} from "../../types.js";
import { createDoubaoTtsProvider } from "./provider.js";
import { defaultDoubaoAudioOptions, DOUBAO_TTS_MODELS } from "./options.js";

export const doubaoAudioSpec: ProviderSpec<
  "doubao",
  TtsProvider,
  AudioProviderOptions
> = {
  id: "doubao",
  label: "Doubao",
  description: "Seed TTS 2.0 with provider word timestamps",
  models: [...DOUBAO_TTS_MODELS],
  defaultModel: () => DOUBAO_TTS_MODELS[0],
  hasCredentials: (env) => Boolean(env.DOUBAO_SPEECH_API_KEY?.trim()),
  defaultOptions: defaultDoubaoAudioOptions,
  create: ({ env }, selection: AudioProviderSelection) =>
    createDoubaoTtsProvider(env, selection),
};
