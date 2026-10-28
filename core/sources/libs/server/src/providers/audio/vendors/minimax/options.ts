import type { Env } from "../../../../env.js";
import type { AudioProviderOptions } from "../../types.js";

export const MINIMAX_TTS_MODELS = [
  "speech-2.8-turbo",
  "speech-2.8-hd",
  "speech-02-turbo",
  "speech-02-hd",
] as const;

export function defaultMinimaxAudioOptions(_env?: Env): AudioProviderOptions {
  return {
    model: MINIMAX_TTS_MODELS[0],
  };
}
