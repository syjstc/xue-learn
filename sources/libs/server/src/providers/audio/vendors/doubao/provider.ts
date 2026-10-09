import type { Env } from "../../../../env.js";
import {
  DOUBAO_CHAT_TTS_MODEL,
  DOUBAO_CHAT_TTS_SPEAKER,
  DOUBAO_CHAT_TTS_TIMING_VERSION,
  synthesizeDoubaoChatSpeechBatch,
} from "../../../../audio/doubao-chat-tts.js";
import type { AudioProviderSelection, TtsProvider } from "../../types.js";

export function createDoubaoTtsProvider(
  _env: Env,
  _selection?: AudioProviderSelection,
): TtsProvider {
  return {
    id: "doubao",
    model: DOUBAO_CHAT_TTS_MODEL,
    speaker: DOUBAO_CHAT_TTS_SPEAKER,
    timingVersion: DOUBAO_CHAT_TTS_TIMING_VERSION,
    chatNarrationBatching: "per_entry",
    synthesizeChatNarration(texts, _options, signal) {
      return synthesizeDoubaoChatSpeechBatch(texts, signal);
    },
  };
}
