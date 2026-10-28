import type { Env } from "../../../../env.js";
import {
  QWEN_AUDIO_TTS_MODEL,
  QWEN_AUDIO_TTS_PLUS_MODEL,
  QWEN_AUDIO_TTS_PLUS_TIMING_VERSION,
  QWEN_AUDIO_TTS_PLUS_VOICE,
  QWEN_AUDIO_TTS_TIMING_VERSION,
  QWEN_AUDIO_TTS_VOICE,
  synthesizeQwenSegmentedSpeech,
  synthesizeQwenSpeech,
  type QwenTtsRequestOptions,
} from "../../../../audio/qwen-audio-tts.js";
import type {
  AudioProviderSelection,
  ChatNarrationCharTiming,
  TtsProvider,
  TtsRequestOptions,
} from "../../types.js";
import { defaultQwenAudioOptions } from "./options.js";

const QWEN_SYSTEM_VOICE = "Maia";

function voiceForModel(model: string): string {
  if (model === QWEN_AUDIO_TTS_MODEL) return QWEN_AUDIO_TTS_VOICE;
  if (model === QWEN_AUDIO_TTS_PLUS_MODEL) return QWEN_AUDIO_TTS_PLUS_VOICE;
  return QWEN_SYSTEM_VOICE;
}

function mergeOptions(
  model: string,
  options: TtsRequestOptions = {},
): QwenTtsRequestOptions {
  const effectiveModel = options.model ?? model;
  return {
    ...options,
    model: effectiveModel,
    voiceId: options.voiceId ?? voiceForModel(effectiveModel),
  };
}

function chatSegments(
  texts: string[],
  segments: Awaited<
    ReturnType<typeof synthesizeQwenSegmentedSpeech>
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

export function createQwenTtsProvider(
  env: Env,
  selection?: AudioProviderSelection,
): TtsProvider {
  const defaults = defaultQwenAudioOptions(env);
  const model =
    selection?.model ??
    selection?.options?.model ??
    defaults.model ??
    QWEN_AUDIO_TTS_MODEL;
  return {
    id: "qwen",
    model,
    speaker: voiceForModel(model),
    timingVersion:
      model === QWEN_AUDIO_TTS_PLUS_MODEL
        ? QWEN_AUDIO_TTS_PLUS_TIMING_VERSION
        : QWEN_AUDIO_TTS_TIMING_VERSION,
    chatNarrationBatching: "per_entry",
    async synthesizeSpeech(text, options, signal) {
      const speech = await synthesizeQwenSpeech(
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
      const speech = await synthesizeQwenSegmentedSpeech(
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
      const speech = await synthesizeQwenSegmentedSpeech(
        cleaned,
        mergeOptions(model, {
          ...options,
          // The shared chat voice profile contains other-provider ids and
          // must not leak into this adapter. Keep legacy Qwen models on their
          // system voice; the cloned voice is bound to the VC snapshot.
          voiceId: voiceForModel(model),
          logOperation: options?.logOperation ?? "tts.chat_narration",
        }),
        signal,
      );
      const segments = chatSegments(cleaned, speech.segments);
      return {
        audio: speech.audio,
        mimeType: speech.mimeType,
        durationMs: speech.durationMs,
        segments,
      };
    },
  };
}
