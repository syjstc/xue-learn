import type { Env } from "../../../../env.js";
import { DOUBAO_CHAT_TTS_MODEL } from "../../../../audio/doubao-chat-tts.js";
import type { AudioProviderOptions } from "../../types.js";

export const DOUBAO_TTS_MODELS = [DOUBAO_CHAT_TTS_MODEL] as const;

export function defaultDoubaoAudioOptions(_env?: Env): AudioProviderOptions {
  return { model: DOUBAO_CHAT_TTS_MODEL };
}
