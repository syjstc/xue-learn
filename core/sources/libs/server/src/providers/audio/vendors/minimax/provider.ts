import type { Env } from "../../../../env.js";
import type { MinimaxTtsRequestOptions } from "../../../../audio/minimax-options.js";
import { resolveMinimaxTtsModel } from "../../../../audio/minimax-tts-model.js";
import {
  encodedAudioToBuffer,
  synthesizeMinimaxSegmentedSpeech,
  synthesizeMinimaxSpeech,
} from "../../../../audio/minimax-tts.js";
import type {
  AudioProviderSelection,
  TtsProvider,
  TtsRequestOptions,
  ChatNarrationCharTiming,
} from "../../types.js";
import { defaultMinimaxAudioOptions } from "./options.js";

function mergeRequestOptions(
  providerModel: string,
  options: TtsRequestOptions = {},
): MinimaxTtsRequestOptions {
  return {
    ...options,
    model: options.model ?? providerModel,
  };
}

export function createMinimaxTtsProvider(
  env: Env,
  selection?: AudioProviderSelection,
): TtsProvider {
  const defaults = defaultMinimaxAudioOptions(env);
  const model = resolveMinimaxTtsModel(
    selection?.model ?? selection?.options?.model ?? defaults.model,
  );

  return {
    id: "minimax",
    model,
    speaker: "warm_girl",
    timingVersion: "minimax-sentence-char-v1",
    synthesizeSpeech(text, options, signal) {
      return synthesizeMinimaxSpeech(
        text,
        mergeRequestOptions(model, options),
        signal,
      );
    },
    synthesizeSegmentedSpeech(segments, options, signal) {
      return synthesizeMinimaxSegmentedSpeech(
        segments,
        mergeRequestOptions(model, options),
        signal,
      );
    },
    async synthesizeChatNarration(texts, options, signal) {
      const cleaned = texts.map((text) => text.trim());
      if (cleaned.length === 0 || cleaned.some((text) => !text)) {
        throw new Error("No speech segments provided");
      }
      const track = await synthesizeMinimaxSegmentedSpeech(
        cleaned,
        mergeRequestOptions(model, {
          ...options,
          model: "speech-2.8-turbo",
          voicePreset: options?.voicePreset ?? "warm_girl",
          languageBoost: "auto",
          narrationStyle: options?.narrationStyle ?? "auto",
          logOperation: "tts.chat_narration",
        }),
        signal,
      );
      const segments = track.segments.map((segment, index) => {
        let offset = 0;
        const chars: ChatNarrationCharTiming[] = (
          segment.chars ??
          [...cleaned[index]!].map((char) => ({
            char,
            startMs: segment.startMs,
            endMs: segment.endMs,
          }))
        ).map((timing) => {
          offset += timing.char.length;
          return { ...timing, endOffset: offset };
        });
        return {
          startMs: segment.startMs,
          endMs: segment.endMs,
          durationMs: Math.max(1, segment.endMs - segment.startMs),
          chars,
        };
      });
      return {
        audio: encodedAudioToBuffer(track.audioBase64),
        mimeType: track.mimeType,
        durationMs: Math.max(1, ...segments.map((segment) => segment.endMs)),
        segments,
      };
    },
  };
}
