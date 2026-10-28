import { randomUUID } from "node:crypto";
import { getEnv } from "../env.js";
import { logLlmRequest } from "../llm/logger.js";
import type { ChatNarrationCharTiming } from "../providers/audio/types.js";

export const DOUBAO_CHAT_TTS_MODEL = "seed-tts-2.0";
export const DOUBAO_ICL_TTS_MODEL = "seed-icl-2.0";
export const DOUBAO_ICL_TTS_MODEL_LEGACY = "seed-icl-1.0";
export const DOUBAO_CHAT_TTS_SPEAKER = "zh_female_vv_uranus_bigtts";
export const DOUBAO_CHAT_TTS_TIMING_VERSION =
  "doubao-word-grapheme-v4-500ms-tail";
/** Trailing pause after the last syllable so a scene cut does not clip speech. */
export const DOUBAO_CHAT_TTS_TAIL_SILENCE_MS = 500;

export type { ChatNarrationCharTiming } from "../providers/audio/types.js";

export type DoubaoTimedSpeech = {
  audio: Buffer;
  mimeType: "audio/mpeg";
  durationMs: number;
  chars: ChatNarrationCharTiming[];
  billedCharacters?: number;
};

export type DoubaoTimedSpeechSegment = {
  startMs: number;
  endMs: number;
  durationMs: number;
  chars: ChatNarrationCharTiming[];
};

export type DoubaoTimedSpeechBatch = DoubaoTimedSpeech & {
  segments: DoubaoTimedSpeechSegment[];
};

const CHAT_NARRATION_SEGMENT_SEPARATOR = "\n\n";
const DOUBAO_SPEECH_AUDIO_CHUNK_CODE = 0;
const DOUBAO_SPEECH_COMPLETED_CODE = 20_000_000;

type DoubaoWord = {
  word?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

type DoubaoChunk = {
  code?: unknown;
  message?: unknown;
  data?: unknown;
  sentence?: { words?: unknown };
  usage?: { text_words?: unknown };
  extra_info?: { audio_length?: unknown };
  duration?: unknown;
};

export type DoubaoSpeechRequestOptions = {
  speaker?: string;
  /** Override X-Api-Resource-Id. Defaults from the speaker family. */
  resourceId?: string;
  /**
   * Clone 2.0 (`S_*` + seed-icl-2.0) requires additions.model_type = 4.
   * Pass `null` to omit it (Clone 1.0 / seed-icl-1.0).
   */
  clonedModelType?: number | null;
  /** additions.post_process.pitch, range [-12, 12]. */
  pitch?: number;
  requireWordTimings?: boolean;
  logOperation?: string;
  logMeta?: Record<string, unknown>;
};

export function isDoubaoClonedSpeaker(speaker: string): boolean {
  return speaker.trim().startsWith("S_");
}

export function resolveDoubaoSpeechResourceId(speaker: string): string {
  const id = speaker.trim();
  if (isDoubaoClonedSpeaker(id)) return DOUBAO_ICL_TTS_MODEL;
  if (id.includes("_uranus_") || id.startsWith("saturn_")) {
    return DOUBAO_CHAT_TTS_MODEL;
  }
  return "seed-tts-1.0";
}

function isDoubaoResourceMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("55000000") || /resource ID is mismatched/i.test(message)
  );
}

export function isSuccessfulDoubaoSpeechCode(code: number): boolean {
  return (
    code === DOUBAO_SPEECH_AUDIO_CHUNK_CODE ||
    code === DOUBAO_SPEECH_COMPLETED_CODE
  );
}

export function buildDoubaoChatSpeechRequest(
  text: string,
  speaker = DOUBAO_CHAT_TTS_SPEAKER,
  clonedModelType?: number | null,
  pitch?: number,
) {
  const additions: Record<string, unknown> = {
    disable_markdown_filter: true,
    disable_emoji_filter: true,
    silence_duration: DOUBAO_CHAT_TTS_TAIL_SILENCE_MS,
  };
  if (clonedModelType != null) additions.model_type = clonedModelType;
  if (typeof pitch === "number" && Number.isFinite(pitch)) {
    additions.post_process = {
      pitch: Math.min(12, Math.max(-12, Math.round(pitch))),
    };
  }
  return {
    req_params: {
      text,
      speaker,
      audio_params: {
        format: "mp3",
        sample_rate: 24_000,
        enable_subtitle: true,
      },
      additions: JSON.stringify(additions),
    },
  };
}

function displayGraphemes(text: string) {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: "grapheme" },
      ) => {
        segment(value: string): Iterable<{ segment: string; index: number }>;
      };
    }
  ).Segmenter;
  if (Segmenter) {
    return [
      ...new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    ].map((item) => ({
      char: item.segment,
      startOffset: item.index,
      endOffset: item.index + item.segment.length,
    }));
  }
  let offset = 0;
  return [...text].map((char) => {
    const startOffset = offset;
    offset += char.length;
    return { char, startOffset, endOffset: offset };
  });
}

function timingText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M}\p{Extended_Pictographic}]/gu, "")
    .toLocaleLowerCase();
}

export function alignDoubaoWordsToDisplayText(
  text: string,
  words: DoubaoWord[],
): ChatNarrationCharTiming[] {
  const graphemes = displayGraphemes(text);
  if (graphemes.length === 0) return [];
  const timings: Array<ChatNarrationCharTiming | undefined> = Array(
    graphemes.length,
  );
  let displayIndex = 0;
  let lastEndMs = 0;

  for (const raw of words) {
    if (
      typeof raw.word !== "string" ||
      typeof raw.startTime !== "number" ||
      typeof raw.endTime !== "number" ||
      !Number.isFinite(raw.startTime) ||
      !Number.isFinite(raw.endTime) ||
      raw.endTime <= raw.startTime
    ) {
      continue;
    }
    const targetLength = Math.max(1, [...timingText(raw.word)].length);
    const claimed: number[] = [];
    let normalizedLength = 0;
    while (displayIndex < graphemes.length && normalizedLength < targetLength) {
      claimed.push(displayIndex);
      normalizedLength += [...timingText(graphemes[displayIndex]!.char)].length;
      displayIndex += 1;
    }
    if (claimed.length === 0) continue;
    const spoken = claimed.filter(
      (index) => timingText(graphemes[index]!.char).length > 0,
    );
    const startMs = Math.max(lastEndMs, Math.round(raw.startTime * 1000));
    const endMs = Math.max(startMs + 1, Math.round(raw.endTime * 1000));
    const step = (endMs - startMs) / Math.max(1, spoken.length);
    let spokenIndex = 0;
    for (const index of claimed) {
      const grapheme = graphemes[index]!;
      if (timingText(grapheme.char).length === 0) {
        const at = Math.round(startMs + step * spokenIndex);
        timings[index] = {
          char: grapheme.char,
          startMs: at,
          endMs: at,
          endOffset: grapheme.endOffset,
        };
        continue;
      }
      timings[index] = {
        char: grapheme.char,
        startMs: Math.round(startMs + step * spokenIndex),
        endMs: Math.round(startMs + step * (spokenIndex + 1)),
        endOffset: grapheme.endOffset,
      };
      spokenIndex += 1;
    }
    lastEndMs = endMs;
  }

  if (lastEndMs <= 0 || timings.every((item) => !item)) return [];
  for (let index = 0; index < graphemes.length; index += 1) {
    if (timings[index]) continue;
    const grapheme = graphemes[index]!;
    timings[index] = {
      char: grapheme.char,
      startMs: lastEndMs,
      endMs: lastEndMs,
      endOffset: grapheme.endOffset,
    };
  }
  return timings as ChatNarrationCharTiming[];
}

function extractJsonFrames(raw: string): DoubaoChunk[] {
  const frames: DoubaoChunk[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          frames.push(JSON.parse(raw.slice(start, index + 1)) as DoubaoChunk);
        } catch {
          // Ignore non-frame transport noise; a missing valid frame fails below.
        }
        start = -1;
      }
    }
  }
  return frames;
}

function durationMsFromDoubaoResult(
  chars: ChatNarrationCharTiming[],
  frames: DoubaoChunk[],
): number | undefined {
  const fromChars =
    chars.length > 0
      ? Math.max(...chars.map((item) => item.endMs))
      : undefined;
  let fromFrames: number | undefined;
  for (const frame of frames) {
    const extra = frame.extra_info?.audio_length;
    if (typeof extra === "number" && Number.isFinite(extra) && extra > 0) {
      fromFrames = extra < 100 ? extra * 1000 : extra;
      break;
    }
    if (
      typeof frame.duration === "number" &&
      Number.isFinite(frame.duration) &&
      frame.duration > 0
    ) {
      fromFrames = frame.duration < 100 ? frame.duration * 1000 : frame.duration;
      break;
    }
  }
  if (fromChars != null && fromFrames != null) {
    return Math.max(fromChars, fromFrames);
  }
  return fromChars ?? fromFrames;
}

async function synthesizeOnce(
  text: string,
  options: DoubaoSpeechRequestOptions = {},
  signal?: AbortSignal,
): Promise<DoubaoTimedSpeech> {
  const env = getEnv();
  const apiKey = env.DOUBAO_SPEECH_API_KEY?.trim();
  if (!apiKey) throw new Error("Doubao speech is not configured");
  const speaker = options.speaker?.trim() || DOUBAO_CHAT_TTS_SPEAKER;
  const requireWordTimings = options.requireWordTimings !== false;
  const resourceId =
    options.resourceId?.trim() || resolveDoubaoSpeechResourceId(speaker);
  const clonedModelType =
    options.clonedModelType === null
      ? undefined
      : (options.clonedModelType ??
        (isDoubaoClonedSpeaker(speaker) ? 4 : undefined));
  const operation = options.logOperation ?? "tts.chat_narration";
  const requestId = randomUUID();
  const started = Date.now();
  const requestLog = {
    provider: "doubao",
    model: resourceId,
    speaker,
    textLength: text.length,
    textPreview: text.slice(0, 500),
    format: "mp3",
    sampleRate: 24_000,
    enableSubtitle: true,
    clonedModelType: clonedModelType ?? null,
    pitch: options.pitch ?? null,
  };

  try {
    const response = await fetch(
      "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
      {
        method: "POST",
        headers: {
          "X-Api-Key": apiKey,
          "X-Api-Resource-Id": resourceId,
          "X-Api-Request-Id": requestId,
          "X-Control-Require-Usage-Tokens-Return": "*",
          "Content-Type": "application/json",
          Connection: "keep-alive",
        },
        body: JSON.stringify(
          buildDoubaoChatSpeechRequest(
            text,
            speaker,
            clonedModelType,
            options.pitch,
          ),
        ),
        signal: signal ?? AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Doubao speech HTTP ${response.status}`);
    }
    const raw = await response.text();
    const frames = extractJsonFrames(raw);
    if (frames.length === 0)
      throw new Error("Doubao speech returned no frames");
    const audioParts: Buffer[] = [];
    const words: DoubaoWord[] = [];
    let billedCharacters: number | undefined;
    for (const frame of frames) {
      if (
        typeof frame.code === "number" &&
        !isSuccessfulDoubaoSpeechCode(frame.code)
      ) {
        throw new Error(
          `Doubao speech error ${frame.code}: ${String(frame.message ?? "unknown")}`,
        );
      }
      if (typeof frame.data === "string" && frame.data) {
        audioParts.push(Buffer.from(frame.data, "base64"));
      }
      if (Array.isArray(frame.sentence?.words)) {
        words.push(...(frame.sentence!.words as DoubaoWord[]));
      }
      if (typeof frame.usage?.text_words === "number") {
        billedCharacters = frame.usage.text_words;
      }
    }
    const audio = Buffer.concat(audioParts);
    const chars = alignDoubaoWordsToDisplayText(text, words);
    if (audio.length === 0)
      throw new Error("Doubao speech returned empty audio");
    if (requireWordTimings && chars.length === 0) {
      throw new Error("Doubao speech returned no usable word timings");
    }
    const durationMs = durationMsFromDoubaoResult(chars, frames);
    if (requireWordTimings && (durationMs == null || durationMs <= 0)) {
      throw new Error("Doubao speech returned no usable word timings");
    }
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "success",
      durationMs: Date.now() - started,
      request: requestLog,
      response: {
        requestId,
        audioBytes: audio.length,
        wordTimingCount: words.length,
        characterTimingCount: chars.length,
        billedCharacters,
      },
      meta: options.logMeta,
    });
    return {
      audio,
      mimeType: "audio/mpeg",
      durationMs: durationMs ?? 0,
      chars,
      billedCharacters,
    };
  } catch (error) {
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "error",
      durationMs: Date.now() - started,
      request: requestLog,
      response: { requestId },
      error: error instanceof Error ? error.message : String(error),
      meta: options.logMeta,
    });
    throw error;
  }
}

async function synthesizeWithRetry(
  text: string,
  options: DoubaoSpeechRequestOptions = {},
  signal?: AbortSignal,
): Promise<DoubaoTimedSpeech> {
  try {
    return await synthesizeOnce(text, options, signal);
  } catch (firstError) {
    if (signal?.aborted) throw firstError;
    const speaker = options.speaker?.trim() || DOUBAO_CHAT_TTS_SPEAKER;
    const resourceId =
      options.resourceId?.trim() || resolveDoubaoSpeechResourceId(speaker);
    if (
      isDoubaoClonedSpeaker(speaker) &&
      isDoubaoResourceMismatchError(firstError) &&
      resourceId === DOUBAO_ICL_TTS_MODEL
    ) {
      return synthesizeOnce(
        text,
        {
          ...options,
          resourceId: DOUBAO_ICL_TTS_MODEL_LEGACY,
          clonedModelType: null,
        },
        signal,
      );
    }
    return synthesizeOnce(text, options, signal);
  }
}

export async function synthesizeDoubaoChatSpeech(
  text: string,
  signal?: AbortSignal,
): Promise<DoubaoTimedSpeech> {
  return synthesizeWithRetry(text, {}, signal);
}

export async function synthesizeDoubaoTimedSpeech(
  text: string,
  options: DoubaoSpeechRequestOptions = {},
  signal?: AbortSignal,
): Promise<{
  audioBase64: string;
  mimeType: "audio/mpeg";
  durationMs?: number;
  chars?: Array<{ char: string; startMs: number; endMs: number }>;
}> {
  const speech = await synthesizeWithRetry(
    text,
    { ...options, requireWordTimings: false },
    signal,
  );
  const chars =
    speech.chars.length > 0
      ? speech.chars.map((item) => ({
          char: item.char,
          startMs: item.startMs,
          endMs: item.endMs,
        }))
      : undefined;
  return {
    audioBase64: speech.audio.toString("base64"),
    mimeType: speech.mimeType,
    durationMs: speech.durationMs > 0 ? speech.durationMs : undefined,
    chars,
  };
}

export function splitDoubaoChatSpeechSegments(
  texts: string[],
  speech: DoubaoTimedSpeech,
): DoubaoTimedSpeechSegment[] {
  let textOffset = 0;
  const segments = texts.map((text, index) => {
    const startOffset = textOffset;
    const endOffset = startOffset + text.length;
    textOffset =
      endOffset +
      (index < texts.length - 1 ? CHAT_NARRATION_SEGMENT_SEPARATOR.length : 0);
    const chars = speech.chars
      .filter(
        (timing) =>
          timing.endOffset > startOffset && timing.endOffset <= endOffset,
      )
      .map((timing) => ({
        ...timing,
        endOffset: timing.endOffset - startOffset,
      }));
    if (chars.length === 0) {
      throw new Error(`Doubao speech segment ${index} has no usable timings`);
    }
    const startMs = chars[0]!.startMs;
    const endMs = Math.max(...chars.map((timing) => timing.endMs));
    return {
      startMs,
      endMs,
      durationMs: Math.max(1, endMs - startMs),
      chars,
    };
  });

  // Word timestamps describe speech, not safe media seek points. Partition the
  // silence between adjacent paragraphs so playback does not cut a word's
  // attack or tail. The first/last segment retain the track edges as well.
  for (let index = 0; index < segments.length - 1; index += 1) {
    const current = segments[index]!;
    const next = segments[index + 1]!;
    const boundary = Math.round((current.endMs + next.startMs) / 2);
    current.endMs = boundary;
    current.durationMs = Math.max(1, current.endMs - current.startMs);
    next.startMs = boundary;
    next.durationMs = Math.max(1, next.endMs - next.startMs);
  }
  if (segments.length > 0) {
    segments[0]!.startMs = 0;
    segments[0]!.durationMs = Math.max(1, segments[0]!.endMs);
    const last = segments.at(-1)!;
    last.endMs = Math.max(last.endMs, speech.durationMs);
    last.durationMs = Math.max(1, last.endMs - last.startMs);
  }
  for (const segment of segments) {
    segment.chars[0]!.startMs = segment.startMs;
    segment.chars.at(-1)!.endMs = segment.endMs;
  }
  return segments;
}

export async function synthesizeDoubaoChatSpeechBatch(
  texts: string[],
  options: DoubaoSpeechRequestOptions = {},
  signal?: AbortSignal,
): Promise<DoubaoTimedSpeechBatch> {
  const cleaned = texts.map((text) => text.trim());
  if (cleaned.length === 0 || cleaned.some((text) => !text)) {
    throw new Error("No speech segments provided");
  }
  const speech = await synthesizeWithRetry(
    cleaned.join(CHAT_NARRATION_SEGMENT_SEPARATOR),
    options,
    signal,
  );
  return {
    ...speech,
    segments: splitDoubaoChatSpeechSegments(cleaned, speech),
  };
}
