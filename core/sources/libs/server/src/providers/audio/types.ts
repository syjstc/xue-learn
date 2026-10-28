import type { MinimaxTtsRequestOptions } from "../../audio/minimax-options.js";
import type { AudioProviderId } from "./ids.js";
import type { ProviderSelection } from "../core/types.js";

export type TtsClip = {
  text: string;
  audioBase64: string;
  mimeType: string;
};

export type TtsSegmentedTrack = {
  audioBase64: string;
  mimeType: string;
  segments: TtsSegment[];
};

export type TtsSegment = {
  text: string;
  startMs: number;
  endMs: number;
  chars: Array<{ char: string; startMs: number; endMs: number }>;
};

export type ChatNarrationCharTiming = {
  char: string;
  startMs: number;
  endMs: number;
  endOffset: number;
};

export type ChatNarrationSegment = {
  startMs: number;
  endMs: number;
  durationMs: number;
  chars: ChatNarrationCharTiming[];
};

export type ChatNarrationTrack = {
  audio: Buffer;
  mimeType: string;
  durationMs: number;
  segments: ChatNarrationSegment[];
};

/** Per-request TTS options (voice, language) stay on each call. */
export type TtsRequestOptions = MinimaxTtsRequestOptions & {
  /** Provider language hint, e.g. `zh` or `en`. */
  languageHint?: string;
  /** Natural-language style instruction for providers that support it. */
  instruction?: string;
  /** Shared provider-specific speed/volume controls. */
  rate?: number;
  pitch?: number;
  volume?: number;
  requireWordTimings?: boolean;
};

/** Provider-level config (model, defaults) — set by env, settings, or router. */
export type AudioProviderOptions = {
  model?: string;
};

export type AudioProviderSelection = ProviderSelection<
  AudioProviderId,
  AudioProviderOptions
>;

export type TtsProvider = {
  id: AudioProviderId;
  model: string;
  speaker: string;
  timingVersion: string;
  /**
   * Providers with unreliable shared-track cut points can request one
   * independently stored track per narration entry.
   */
  chatNarrationBatching?: "shared_track" | "per_entry";
  synthesizeSpeech?(
    text: string,
    options?: TtsRequestOptions,
    signal?: AbortSignal,
  ): Promise<TtsClip>;
  synthesizeSegmentedSpeech?(
    segments: string[],
    options?: TtsRequestOptions,
    signal?: AbortSignal,
  ): Promise<TtsSegmentedTrack>;
  synthesizeChatNarration(
    texts: string[],
    options?: TtsRequestOptions,
    signal?: AbortSignal,
  ): Promise<ChatNarrationTrack>;
};
