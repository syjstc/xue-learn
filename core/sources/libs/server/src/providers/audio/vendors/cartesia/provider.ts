import type { Env } from "../../../../env.js";
import {
  CARTESIA_TTS_MODEL,
  CARTESIA_TTS_TIMING_VERSION,
  CARTESIA_TTS_VOICE,
  synthesizeCartesiaSegmentedSpeech,
  synthesizeCartesiaSpeech,
  type CartesiaTtsRequestOptions,
} from "../../../../audio/cartesia-tts.js";
import type {
  AudioProviderSelection,
  ChatNarrationCharTiming,
  TtsProvider,
  TtsRequestOptions,
} from "../../types.js";
import { defaultCartesiaAudioOptions } from "./options.js";

function mergeOptions(
  model: string,
  options: TtsRequestOptions = {},
): CartesiaTtsRequestOptions {
  return { ...options, model: options.model ?? model };
}

function chatSegments(
  texts: string[],
  segments: Awaited<
    ReturnType<typeof synthesizeCartesiaSegmentedSpeech>
  >["segments"],
) {
  return segments.map((segment, index) => {
    let offset = 0;
    const chars: ChatNarrationCharTiming[] = segment.chars.map((timing) => {
      offset += timing.char.length;
      return { ...timing, endOffset: offset };
    });
    return {
      startMs: segment.startMs,
      endMs: segment.endMs,
      durationMs: Math.max(1, segment.durationMs),
      chars:
        chars.length > 0
          ? chars
          : [...texts[index]!].map((char) => {
              const item = {
                char,
                startMs: segment.startMs,
                endMs: segment.endMs,
                endOffset: offset + char.length,
              };
              offset += char.length;
              return item;
            }),
    };
  });
}

export function createCartesiaTtsProvider(
  env: Env,
  selection?: AudioProviderSelection,
): TtsProvider {
  const defaults = defaultCartesiaAudioOptions(env);
  const model =
    selection?.model ??
    selection?.options?.model ??
    defaults.model ??
    CARTESIA_TTS_MODEL;
  return {
    id: "cartesia",
    model,
    speaker: CARTESIA_TTS_VOICE,
    timingVersion: CARTESIA_TTS_TIMING_VERSION,
    chatNarrationBatching: "per_entry",
    async synthesizeSpeech(text, options, signal) {
      const speech = await synthesizeCartesiaSpeech(
        text,
        mergeOptions(model, options),
        signal,
      );
      return {
        text,
        audioBase64: speech.audio.toString("base64"),
        mimeType: speech.mimeType,
      };
    },
    async synthesizeSegmentedSpeech(segments, options, signal) {
      const speech = await synthesizeCartesiaSegmentedSpeech(
        segments,
        mergeOptions(model, options),
        signal,
      );
      return {
        audioBase64: speech.audio.toString("base64"),
        mimeType: speech.mimeType,
        segments: speech.segments,
      };
    },
    async synthesizeChatNarration(texts, options, signal) {
      const cleaned = texts.map((text) => text.trim());
      if (cleaned.length === 0 || cleaned.some((text) => !text)) {
        throw new Error("No speech segments provided");
      }
      const speech = await synthesizeCartesiaSegmentedSpeech(
        cleaned,
        mergeOptions(model, {
          ...options,
          voiceId: CARTESIA_TTS_VOICE,
          logOperation: options?.logOperation ?? "tts.chat_narration",
        }),
        signal,
      );
      return {
        audio: speech.audio,
        mimeType: speech.mimeType,
        durationMs: speech.durationMs,
        segments: chatSegments(cleaned, speech.segments),
      };
    },
  };
}
