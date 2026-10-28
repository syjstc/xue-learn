import { getEnv } from "../env.js";
import {
  alignSentenceSubtitlesToSegments,
  parseMinimaxSubtitleJson,
  type MinimaxSubtitleLine,
} from "./minimax-subtitles.js";
import {
  applyNarrationStyleToVoice,
  resolveMinimaxTtsLanguageBoost,
  resolveMinimaxTtsNarrationStyle,
  resolveMinimaxTtsVoicePreset,
  type MinimaxTtsRequestOptions,
} from "./minimax-options.js";
import { MINIMAX_TTS_AUDIO_SETTING } from "./minimax-tts-audio.js";
import { resolveMinimaxTtsModel } from "./minimax-tts-model.js";
import { logLlmRequest } from "../llm/logger.js";
import {
  MinimaxTtsApiError,
  MINIMAX_TTS_RATE_LIMIT_RETRY_MS,
  isMinimaxTtsRateLimitError,
} from "./minimax-tts-shared.js";

export {
  MinimaxTtsApiError,
  MINIMAX_TTS_RATE_LIMIT_RETRY_MS,
  isMinimaxTtsRateLimitError,
} from "./minimax-tts-shared.js";

type MinimaxTtsResponse = {
  base_resp?: { status_code?: number; status_msg?: string };
  data?: { audio?: string; subtitle_file?: string };
  extra_info?: { audio_length?: number };
};

export type TtsClip = {
  text: string;
  audioBase64: string;
  mimeType: string;
};

export type TtsSegmentedTrack = {
  audioBase64: string;
  mimeType: string;
  segments: Array<{
    text: string;
    startMs: number;
    endMs: number;
    chars: Array<{ char: string; startMs: number; endMs: number }>;
  }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function minimaxTtsUrl(): string {
  const env = getEnv();
  const base = env.MINIMAX_BASE_URL.replace(/\/$/, "");
  const groupId = env.MINIMAX_GROUP_ID?.trim();
  if (!env.MINIMAX_API_KEY?.trim() || !groupId) {
    throw new Error("MiniMax audio is not configured");
  }
  return `${base}/t2a_v2?GroupId=${encodeURIComponent(groupId)}`;
}

export function encodedAudioToBuffer(audio: string): Buffer {
  const trimmed = audio.trim();
  if (/^[a-f0-9]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}

function encodedAudioToBase64(audio: string): string {
  return encodedAudioToBuffer(audio).toString("base64");
}

async function fetchMinimaxSubtitleFile(
  url: string,
  signal?: AbortSignal,
): Promise<MinimaxSubtitleLine[]> {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`MiniMax subtitle download HTTP ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  return parseMinimaxSubtitleJson(json);
}

function buildTtsLogRequest(
  text: string,
  withSubtitles: boolean,
  options: MinimaxTtsRequestOptions,
): Record<string, unknown> {
  const model = resolveMinimaxTtsModel(options.model);
  const languageBoost = resolveMinimaxTtsLanguageBoost(options.languageBoost);
  const voice = resolveMinimaxTtsVoicePreset(
    options.voicePreset,
    languageBoost,
    options.voiceId,
  );
  const narration = resolveMinimaxTtsNarrationStyle(options.narrationStyle);
  const voiceSetting = applyNarrationStyleToVoice(voice, narration);
  return {
    model,
    textLength: text.length,
    textPreview: text.slice(0, 500),
    withSubtitles,
    subtitle_enable: withSubtitles,
    subtitleTiming: withSubtitles
      ? "provider_sentence_to_local_char"
      : undefined,
    voicePreset: voice.code,
    voiceId: voice.voiceId,
    languageBoost,
    narrationStyle: narration.code,
    emotion: voiceSetting.emotion ?? null,
  };
}

function sanitizeTtsApiResponse(
  json: MinimaxTtsResponse,
  subtitles: MinimaxSubtitleLine[],
): Record<string, unknown> {
  const audio = json.data?.audio;
  return {
    base_resp: json.base_resp,
    extra_info: json.extra_info,
    data: {
      subtitle_file: json.data?.subtitle_file ?? null,
      audioOmitted: true,
      audioEncodedLength: audio?.length ?? 0,
    },
    providerSubtitleGranularity: "sentence",
    providerSubtitleCount: subtitles.length,
    providerSubtitles: subtitles.length > 0 ? subtitles.slice(0, 12) : undefined,
  };
}

async function synthesizeMinimaxSpeechOnce(
  text: string,
  options: MinimaxTtsRequestOptions = {},
  signal?: AbortSignal,
  withSubtitles = false,
): Promise<{ clip: TtsClip; subtitles: MinimaxSubtitleLine[]; durationMs?: number }> {
  const env = getEnv();
  const model = resolveMinimaxTtsModel(options.model);
  const languageBoost = resolveMinimaxTtsLanguageBoost(options.languageBoost);
  const voice = resolveMinimaxTtsVoicePreset(
    options.voicePreset,
    languageBoost,
    options.voiceId,
  );
  const narration = resolveMinimaxTtsNarrationStyle(options.narrationStyle);
  const voiceSetting = applyNarrationStyleToVoice(voice, narration);
  const started = Date.now();
  const operation =
    options.logOperation ??
    (withSubtitles ? "tts.speech_segmented" : "tts.speech");
  const logRequest = buildTtsLogRequest(text, withSubtitles, options);

  try {
    const res = await fetch(minimaxTtsUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MINIMAX_API_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        text,
        stream: false,
        subtitle_enable: withSubtitles,
        language_boost: languageBoost === "auto" ? undefined : languageBoost,
        voice_setting: {
          voice_id: voice.voiceId,
          speed: voiceSetting.speed,
          vol: voiceSetting.vol,
          pitch: voiceSetting.pitch,
          ...(voiceSetting.emotion ? { emotion: voiceSetting.emotion } : {}),
        },
        audio_setting: MINIMAX_TTS_AUDIO_SETTING,
      }),
      signal: signal ?? AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const message = `MiniMax audio API HTTP ${res.status}: ${body.slice(0, 300)}`;
      await logLlmRequest({
        operation,
        kind: "audio",
        status: "error",
        durationMs: Date.now() - started,
        request: logRequest,
        response: { httpStatus: res.status, bodyPreview: body.slice(0, 500) },
        error: message,
        meta: options.logMeta,
      });
      throw new Error(message);
    }

    const json = (await res.json()) as MinimaxTtsResponse;
    const statusCode = json.base_resp?.status_code ?? 0;
    if (statusCode !== 0) {
      const message = `MiniMax audio API error ${statusCode}: ${json.base_resp?.status_msg ?? "unknown"}`;
      await logLlmRequest({
        operation,
        kind: "audio",
        status: "error",
        durationMs: Date.now() - started,
        request: logRequest,
        response: sanitizeTtsApiResponse(json, []),
        error: message,
        meta: options.logMeta,
      });
      throw new MinimaxTtsApiError(message, statusCode);
    }

    const audio = json.data?.audio;
    if (!audio) {
      const message = "MiniMax audio API returned no audio";
      await logLlmRequest({
        operation,
        kind: "audio",
        status: "error",
        durationMs: Date.now() - started,
        request: logRequest,
        response: sanitizeTtsApiResponse(json, []),
        error: message,
        meta: options.logMeta,
      });
      throw new Error(message);
    }

    const clip: TtsClip = {
      text,
      audioBase64: encodedAudioToBase64(audio),
      mimeType: "audio/mpeg",
    };
    const subtitles =
      withSubtitles && json.data?.subtitle_file
        ? await fetchMinimaxSubtitleFile(json.data.subtitle_file, signal)
        : [];

    await logLlmRequest({
      operation,
      kind: "audio",
      status: "success",
      durationMs: Date.now() - started,
      request: logRequest,
      response: sanitizeTtsApiResponse(json, subtitles),
      meta: options.logMeta,
    });

    return {
      clip,
      subtitles,
      durationMs: json.extra_info?.audio_length,
    };
  } catch (error) {
    if (
      error instanceof MinimaxTtsApiError ||
      (error instanceof Error &&
        (error.message.startsWith("MiniMax audio API HTTP") ||
          error.message === "MiniMax audio API returned no audio"))
    ) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "error",
      durationMs: Date.now() - started,
      request: logRequest,
      error: message,
      meta: options.logMeta,
    });
    throw error;
  }
}

async function withMinimaxRateLimitRetry<T>(
  run: () => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      const canRetry =
        isMinimaxTtsRateLimitError(error) && attempt < maxAttempts - 1;
      if (!canRetry) throw error;
      await sleep(MINIMAX_TTS_RATE_LIMIT_RETRY_MS);
    }
  }
  throw new Error("MiniMax audio synthesis failed");
}

export async function synthesizeMinimaxTimedSpeech(
  text: string,
  options: MinimaxTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<
  TtsClip & {
    durationMs?: number;
    chars?: Array<{ char: string; startMs: number; endMs: number }>;
  }
> {
  const withSubtitles = options.subtitleEnable === true;
  const result = await withMinimaxRateLimitRetry(() =>
    synthesizeMinimaxSpeechOnce(text, options, signal, withSubtitles),
  );
  const chars = withSubtitles
    ? alignSentenceSubtitlesToSegments(
        [text],
        result.subtitles,
        result.durationMs,
      )[0]?.chars
    : undefined;
  return { ...result.clip, durationMs: result.durationMs, chars };
}

export async function synthesizeMinimaxSpeech(
  text: string,
  options: MinimaxTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<TtsClip> {
  return synthesizeMinimaxTimedSpeech(text, options, signal);
}

async function synthesizeCombinedSegmentedSpeech(
  combined: string,
  segmentTexts: string[],
  options: MinimaxTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<TtsSegmentedTrack> {
  if (!combined.trim() || segmentTexts.length === 0) {
    throw new Error("No speech segments provided");
  }
  const result = await withMinimaxRateLimitRetry(() =>
    synthesizeMinimaxSpeechOnce(combined, options, signal, true),
  );
  const aligned = alignSentenceSubtitlesToSegments(
    segmentTexts,
    result.subtitles,
    result.durationMs,
  );
  return {
    audioBase64: result.clip.audioBase64,
    mimeType: result.clip.mimeType,
    segments: aligned,
  };
}

export async function synthesizeMinimaxSegmentedSpeech(
  segments: string[],
  options: MinimaxTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<TtsSegmentedTrack> {
  const cleaned = segments.map((segment) => segment.trim()).filter(Boolean);
  return synthesizeCombinedSegmentedSpeech(
    cleaned.join("<#0.35#>"),
    cleaned,
    options,
    signal,
  );
}
