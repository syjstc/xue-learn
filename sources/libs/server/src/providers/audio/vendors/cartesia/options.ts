import type { Env } from "../../../../env.js";
import { CARTESIA_TTS_MODEL } from "../../../../audio/cartesia-tts.js";
import type { AudioProviderOptions } from "../../types.js";

export const CARTESIA_TTS_MODELS = [CARTESIA_TTS_MODEL] as const;

export function defaultCartesiaAudioOptions(_env?: Env): AudioProviderOptions {
  return { model: CARTESIA_TTS_MODEL };
}
