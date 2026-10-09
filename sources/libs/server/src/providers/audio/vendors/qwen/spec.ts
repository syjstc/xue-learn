import type { ProviderSpec } from "../../../core/types.js";
import type {
  AudioProviderOptions,
  AudioProviderSelection,
  TtsProvider,
} from "../../types.js";
import { createQwenTtsProvider } from "./provider.js";
import { defaultQwenAudioOptions, QWEN_TTS_MODELS } from "./options.js";

export const qwenAudioSpec: ProviderSpec<
  "qwen",
  TtsProvider,
  AudioProviderOptions
> = {
  id: "qwen",
  label: "Qwen Audio",
  description: "Qwen3-TTS voice clone with SSE word timestamps",
  models: [...QWEN_TTS_MODELS],
  defaultModel: () => QWEN_TTS_MODELS[0],
  hasCredentials: (env) => Boolean(env.DASHSCOPE_API_KEY?.trim()),
  defaultOptions: defaultQwenAudioOptions,
  create: ({ env }, selection: AudioProviderSelection) =>
    createQwenTtsProvider(env, selection),
};
