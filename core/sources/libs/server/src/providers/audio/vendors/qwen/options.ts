import type { Env } from "../../../../env.js";
import type { AudioProviderOptions } from "../../types.js";
import { QWEN_AUDIO_TTS_MODEL } from "../../../../audio/qwen-audio-tts.js";

export const QWEN_TTS_MODELS = [
  QWEN_AUDIO_TTS_MODEL,
  "qwen3-tts-flash",
  "qwen3-tts-instruct-flash",
  "qwen-audio-3.0-tts-plus",
] as const;

export function defaultQwenAudioOptions(_env?: Env): AudioProviderOptions {
  return { model: QWEN_AUDIO_TTS_MODEL };
}
