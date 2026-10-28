import type { ProviderSpec } from "../../../core/types.js";
import type { AudioProviderOptions, AudioProviderSelection, TtsProvider } from "../../types.js";
import { createMinimaxTtsProvider } from "./provider.js";
import { defaultMinimaxAudioOptions, MINIMAX_TTS_MODELS } from "./options.js";

export const minimaxAudioSpec: ProviderSpec<
  "minimax",
  TtsProvider,
  AudioProviderOptions
> = {
  id: "minimax",
  label: "MiniMax",
  description: "speech-2.8 TTS with optional interjection tags in cue subtitles",
  models: [...MINIMAX_TTS_MODELS],
  defaultModel: () => MINIMAX_TTS_MODELS[0],
  hasCredentials: (env) =>
    Boolean(env.MINIMAX_API_KEY?.trim() && env.MINIMAX_GROUP_ID?.trim()),
  defaultOptions: defaultMinimaxAudioOptions,
  create: ({ env }, selection: AudioProviderSelection) =>
    createMinimaxTtsProvider(env, {
      id: "minimax",
      model: selection.model,
      options: {
        ...defaultMinimaxAudioOptions(env),
        ...selection.options,
      },
    }),
};
