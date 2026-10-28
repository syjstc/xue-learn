import type { ProviderSpec } from "../../../core/types.js";
import type {
  AudioProviderOptions,
  AudioProviderSelection,
  TtsProvider,
} from "../../types.js";
import { createCartesiaTtsProvider } from "./provider.js";
import { CARTESIA_TTS_MODELS, defaultCartesiaAudioOptions } from "./options.js";

export const cartesiaAudioSpec: ProviderSpec<
  "cartesia",
  TtsProvider,
  AudioProviderOptions
> = {
  id: "cartesia",
  label: "Cartesia",
  description: "Cartesia Sonic TTS with SSE word timestamps",
  models: [...CARTESIA_TTS_MODELS],
  defaultModel: () => CARTESIA_TTS_MODELS[0],
  hasCredentials: (env) => Boolean(env.CARTESIA_API_KEY?.trim()),
  defaultOptions: defaultCartesiaAudioOptions,
  create: ({ env }, selection: AudioProviderSelection) =>
    createCartesiaTtsProvider(env, selection),
};
