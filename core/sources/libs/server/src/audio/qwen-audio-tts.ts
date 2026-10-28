import { getRuntimeEnvironment } from "../env.js";
import { randomUUID } from "node:crypto";
import { getEnv } from "../env.js";
import { logLlmRequest } from "../llm/logger.js";
import { parseMp3Frames } from "./mp3-slice.js";
import { linearHighlightCharsForText } from "./minimax-subtitles.js";
import {
  boostMp3Volume,
  dbToLinearGain,
  encodePcmS16leToMp3,
  gainPcmS16le,
} from "./pcm-mp3.js";

// This is the Qwen-TTS voice-cloning snapshot returned by DashScope. The
// cloned voice is bound to this exact model and must not be paired with the
// ordinary qwen3-tts-flash model.
export const QWEN_AUDIO_TTS_MODEL = "qwen3-tts-vc-2026-01-22";
export const QWEN_AUDIO_TTS_VOICE =
  "qwen-tts-vc-xuelearn-voice-20260904082112307-1687";
/** Separate CosyVoice clone; do not pair with the Qwen3-TTS-VC voice id. */
export const QWEN_AUDIO_TTS_PLUS_MODEL = "qwen-audio-3.0-tts-plus";
export const QWEN_AUDIO_TTS_PLUS_VOICE =
  "qwen-audio-3.0-tts-plus-xueplus-20a866f596a1408f996989f5edaf6cea";
export const QWEN_AUDIO_TTS_PLUS_TIMING_VERSION =
  "qwen-audio-3.0-tts-plus-xueplus-v2-rate-1-seed-42";
export const QWEN_AUDIO_TTS_DEFAULT_RATE = 0.9;
/** CosyVoice default. Do not reuse the Qwen3-TTS 0.9 classroom slowdown. */
export const QWEN_AUDIO_TTS_PLUS_DEFAULT_RATE = 1;
/** Pin CosyVoice sampling. Omitting seed (or relying on vendor 0) is not stable. */
export const QWEN_AUDIO_TTS_PLUS_SEED = 42;
/** CosyVoice / Qwen-Audio-TTS only (0–100). Qwen3-TTS HTTP ignores this. */
export const QWEN_AUDIO_TTS_DEFAULT_VOLUME = 80;
/** Qwen3-TTS clone audio is quiet; apply after download. Bump timingVersion. */
export const QWEN_AUDIO_TTS_POST_GAIN_DB = 10;
export const QWEN_AUDIO_TTS_TIMING_VERSION =
  "qwen3-tts-vc-2026-01-22-v2-rate-0.9-gain-10db";
export const QWEN_AUDIO_TTS_SAMPLE_RATE = 24_000;

export type QwenTtsRequestOptions = {
  /** Qwen-TTS voice. Defaults to the configured cloned voice. */
  voiceId?: string;
  model?: string;
  languageHint?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** CosyVoice sampling seed (0–65535). Ignored by Qwen3-TTS HTTP. */
  seed?: number;
  /** Natural-language expression control supported by Qwen-Audio-TTS. */
  instruction?: string;
  /** Require provider word timings instead of accepting linear fallback. */
  requireWordTimings?: boolean;
  logOperation?: string;
  logMeta?: Record<string, unknown>;
};

export type QwenTimedSpeech = {
  audio: Buffer;
  mimeType: "audio/mpeg";
  durationMs: number;
  chars: Array<{ char: string; startMs: number; endMs: number }>;
};

export type QwenTimedSpeechSegment = {
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  chars: Array<{ char: string; startMs: number; endMs: number }>;
};

export type QwenTimedSpeechBatch = {
  audio: Buffer;
  mimeType: "audio/mpeg";
  durationMs: number;
  segments: QwenTimedSpeechSegment[];
};

type QwenWord = {
  text?: unknown;
  begin_index?: unknown;
  end_index?: unknown;
  begin_time?: unknown;
  end_time?: unknown;
};

type QwenStreamEvent = {
  request_id?: unknown;
  code?: unknown;
  message?: unknown;
  output?: {
    finish_reason?: unknown;
    type?: unknown;
    original_text?: unknown;
    sentence?: { index?: unknown; words?: unknown };
    audio?: { data?: unknown; url?: unknown; id?: unknown };
  };
  usage?: { characters?: unknown };
};

type QwenSentence = {
  index: number;
  originalText?: string;
  words: QwenWord[];
};

type QwenStreamResult = {
  audio: Buffer;
  sentences: QwenSentence[];
  billedCharacters?: number;
  requestId?: string;
};

type AlignedChar = {
  char: string;
  startMs: number;
  endMs: number;
  startOffset: number;
  endOffset: number;
};

export function isQwenAigcTtsModel(model: string): boolean {
  return model.startsWith("qwen3-tts") || model.startsWith("qwen-tts");
}

function qwenAudioTtsUrl(model?: string): string {
  const env = getEnv();
  const configured =
    getRuntimeEnvironment().DASHSCOPE_AUDIO_BASE_URL?.trim() || env.DASHSCOPE_BASE_URL;
  let base: URL;
  try {
    base = new URL(configured);
  } catch {
    throw new Error("DASHSCOPE_BASE_URL is not a valid URL");
  }

  // DASHSCOPE_BASE_URL is normally the OpenAI-compatible
  // `/compatible-mode/v1` endpoint. Qwen-Audio-TTS uses the separate
  // `/api/v1/services/audio/tts/SpeechSynthesizer` endpoint on the same host,
  // while Qwen3-TTS uses `/api/v1/services/aigc/multimodal-generation/generation`.
  const path = base.pathname
    .replace(/\/(?:compatible-mode\/)?v1\/?$/, "")
    .replace(/\/$/, "");
  if (model && isQwenAigcTtsModel(model)) {
    base.pathname = `${path}/api/v1/services/aigc/multimodal-generation/generation`;
  } else {
    base.pathname = `${path}/api/v1/services/audio/tts/SpeechSynthesizer`;
  }
  base.search = "";
  base.hash = "";
  return base.toString();
}

function clamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function buildRequest(
  text: string,
  options: QwenTtsRequestOptions,
  model: string,
  voice: string,
): Record<string, unknown> {
  const volume = Math.round(
    clamp(options.volume, 0, 100, QWEN_AUDIO_TTS_DEFAULT_VOLUME),
  );
  if (isQwenAigcTtsModel(model)) {
    const input: Record<string, unknown> = {
      text,
      voice,
    };
    if (options.languageHint?.trim()) {
      input.language_type = options.languageHint.trim();
    }
    if (options.instruction?.trim()) {
      input.instructions = options.instruction.trim();
      input.optimize_instructions = true;
    }
    return {
      model,
      input,
      parameters: {
        format: "mp3",
        sample_rate: QWEN_AUDIO_TTS_SAMPLE_RATE,
        // Qwen3-TTS HTTP does not document or honor volume.
        speech_rate: clamp(options.rate, 0.5, 2, QWEN_AUDIO_TTS_DEFAULT_RATE),
        pitch_rate: clamp(options.pitch, 0.5, 2, 1),
      },
    };
  }

  const input: Record<string, unknown> = {
    text,
    voice,
    format: "mp3",
    sample_rate: QWEN_AUDIO_TTS_SAMPLE_RATE,
    volume,
    rate: clamp(options.rate, 0.5, 2, QWEN_AUDIO_TTS_PLUS_DEFAULT_RATE),
    pitch: clamp(options.pitch, 0.5, 2, 1),
    seed: Math.round(clamp(options.seed, 0, 65_535, QWEN_AUDIO_TTS_PLUS_SEED)),
    word_timestamp_enabled: true,
  };
  if (options.languageHint?.trim()) {
    input.language_hints = [options.languageHint.trim()];
  }
  if (options.instruction?.trim()) {
    input.instruction = options.instruction.trim();
  }
  return { model, input };
}

function requestLog(
  text: string,
  options: QwenTtsRequestOptions,
  model: string,
  voice: string,
) {
  return {
    provider: "qwen",
    model,
    voice,
    textLength: text.length,
    textPreview: text.slice(0, 500),
    format: "mp3",
    sampleRate: QWEN_AUDIO_TTS_SAMPLE_RATE,
    volume: isQwenAigcTtsModel(model)
      ? undefined
      : Math.round(
          clamp(options.volume, 0, 100, QWEN_AUDIO_TTS_DEFAULT_VOLUME),
        ),
    postGainDb: isQwenAigcTtsModel(model) ? QWEN_AUDIO_TTS_POST_GAIN_DB : 0,
    rate: isQwenAigcTtsModel(model)
      ? clamp(options.rate, 0.5, 2, QWEN_AUDIO_TTS_DEFAULT_RATE)
      : clamp(options.rate, 0.5, 2, QWEN_AUDIO_TTS_PLUS_DEFAULT_RATE),
    seed: isQwenAigcTtsModel(model)
      ? undefined
      : Math.round(clamp(options.seed, 0, 65_535, QWEN_AUDIO_TTS_PLUS_SEED)),
    wordTimestampEnabled: true,
    instruction: options.instruction?.trim() || null,
  };
}

function decodeAudioData(value: unknown): Buffer | null {
  if (typeof value !== "string" || !value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  try {
    const audio = Buffer.from(trimmed, "base64");
    return audio.length > 0 ? audio : null;
  } catch {
    return null;
  }
}

function parseSseBlock(block: string): QwenStreamEvent | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as QwenStreamEvent;
  } catch {
    throw new Error("Qwen audio API returned an invalid SSE event");
  }
}

async function downloadAudio(
  url: string,
  signal: AbortSignal,
): Promise<Buffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Qwen audio download HTTP ${response.status}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length) throw new Error("Qwen audio download returned empty audio");
  return body;
}

function wavPcmS16le(audio: Buffer): {
  pcm: Buffer;
  sampleRate: number;
} | null {
  if (
    audio.length < 12 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataStart = -1;
  let dataEnd = -1;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = Math.min(audio.length, chunkStart + chunkSize);
    const chunkId = audio.toString("ascii", offset, offset + 4);
    if (
      chunkId === "fmt " &&
      chunkSize >= 16 &&
      chunkStart + 16 <= audio.length
    ) {
      audioFormat = audio.readUInt16LE(chunkStart);
      channels = audio.readUInt16LE(chunkStart + 2);
      sampleRate = audio.readUInt32LE(chunkStart + 4);
      bitsPerSample = audio.readUInt16LE(chunkStart + 14);
    } else if (chunkId === "data") {
      dataStart = chunkStart;
      dataEnd = chunkEnd;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (
    audioFormat !== 1 ||
    channels !== 1 ||
    bitsPerSample !== 16 ||
    sampleRate <= 0 ||
    dataStart < 0 ||
    dataEnd <= dataStart
  ) {
    return null;
  }
  return { pcm: audio.subarray(dataStart, dataEnd), sampleRate };
}

async function normalizeQwenAudio(
  audio: Buffer,
  model: string,
): Promise<Buffer> {
  const gainDb = isQwenAigcTtsModel(model) ? QWEN_AUDIO_TTS_POST_GAIN_DB : 0;
  const wav = wavPcmS16le(audio);
  if (wav) {
    const pcm =
      gainDb === 0 ? wav.pcm : gainPcmS16le(wav.pcm, dbToLinearGain(gainDb));
    return encodePcmS16leToMp3(pcm, wav.sampleRate);
  }
  if (gainDb !== 0 && parseMp3Frames(audio).length > 0) {
    return boostMp3Volume(audio, gainDb);
  }
  return audio;
}

async function readQwenStream(
  response: Response,
  signal: AbortSignal,
  model: string,
): Promise<QwenStreamResult> {
  if (!response.body)
    throw new Error("Qwen audio API returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completeAudioUrl: string | undefined;
  const audioParts: Buffer[] = [];
  const sentenceByIndex = new Map<number, QwenSentence>();
  let billedCharacters: number | undefined;
  let requestId: string | undefined;

  const consume = (block: string) => {
    const event = parseSseBlock(block);
    if (!event) return;
    if (typeof event.request_id === "string") requestId = event.request_id;
    if (event.code !== undefined && Number(event.code) !== 0) {
      throw new Error(
        `Qwen audio API error ${String(event.code)}: ${String(event.message ?? "unknown")}`,
      );
    }
    const output = event.output;
    if (!output) return;
    const audio = output.audio;
    if (typeof audio?.url === "string" && audio.url) {
      // DashScope's final streaming event may carry both the last chunk and
      // the complete URL. The complete URL is authoritative and avoids
      // duplicating that final chunk when the provider sends both.
      completeAudioUrl = audio.url;
    } else {
      const part = decodeAudioData(audio?.data);
      if (part) audioParts.push(part);
    }
    const sentence = output.sentence;
    const index = Number(sentence?.index);
    if (Number.isInteger(index) && index >= 0) {
      const words = Array.isArray(sentence?.words)
        ? (sentence.words as QwenWord[])
        : [];
      const previous = sentenceByIndex.get(index);
      if (!previous || words.length >= previous.words.length) {
        sentenceByIndex.set(index, {
          index,
          originalText:
            typeof output.original_text === "string"
              ? output.original_text
              : previous?.originalText,
          words,
        });
      }
    }
    const characters = Number(event.usage?.characters);
    if (Number.isFinite(characters) && characters >= 0) {
      billedCharacters = characters;
    }
  };

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      pending += decoder.decode(next.value, { stream: true });
      for (;;) {
        const separator = pending.search(/\r?\n\r?\n/);
        if (separator < 0) break;
        const match = pending.slice(separator).match(/^\r?\n\r?\n/);
        const separatorLength = match?.[0].length ?? 2;
        const block = pending.slice(0, separator);
        pending = pending.slice(separator + separatorLength);
        consume(block);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) consume(pending);
  } finally {
    reader.releaseLock();
  }

  const audio = completeAudioUrl
    ? await downloadAudio(completeAudioUrl, signal)
    : Buffer.concat(audioParts);
  if (!audio.length) throw new Error("Qwen audio API returned empty audio");
  return {
    audio: await normalizeQwenAudio(audio, model),
    sentences: [...sentenceByIndex.values()].sort((a, b) => a.index - b.index),
    billedCharacters,
    requestId,
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

function searchable(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
}

function locateSpan(
  text: string,
  needle: string,
  fromOffset: number,
): { start: number; end: number } | null {
  const exact = text.indexOf(needle, fromOffset);
  if (exact >= 0) return { start: exact, end: exact + needle.length };
  const target = searchable(needle);
  if (!target) return null;
  const offsets: number[] = [];
  let compact = "";
  for (let index = fromOffset; index < text.length; index += 1) {
    if (/\s/uy.test(text[index]!)) continue;
    offsets.push(index);
    compact += searchable(text[index]!);
    if (compact.endsWith(target)) {
      const startIndex = offsets.length - [...target].length;
      return {
        start: offsets[Math.max(0, startIndex)]!,
        end: offsets[offsets.length - 1]! + 1,
      };
    }
    if (compact.length > target.length * 2) {
      compact = compact.slice(-target.length);
      offsets.splice(0, Math.max(0, offsets.length - target.length));
    }
  }
  return null;
}

function qwenWordTimeMs(value: unknown, scale: number): number {
  return Number(value) * scale;
}

function qwenTimestampScaleMs(
  sentences: QwenSentence[],
  audioDurationMs: number,
): number {
  let maxEnd = 0;
  for (const sentence of sentences) {
    for (const word of sentence.words) {
      const end = Number(word.end_time);
      if (Number.isFinite(end)) maxEnd = Math.max(maxEnd, end);
    }
  }
  if (maxEnd > 0 && maxEnd * 50 < audioDurationMs) return 1000;
  return 1;
}

function wordSpanInSentence(
  text: string,
  word: QwenWord,
  span: { start: number; end: number },
  fromOffset: number,
): { start: number; end: number } | null {
  const sentenceLen = span.end - span.start;
  const beginIndex = Number(word.begin_index);
  const endIndex = Number(word.end_index);
  if (
    Number.isInteger(beginIndex) &&
    Number.isInteger(endIndex) &&
    beginIndex >= 0 &&
    beginIndex < sentenceLen
  ) {
    return {
      start: span.start + beginIndex,
      end: Math.min(span.end, span.start + Math.max(beginIndex + 1, endIndex)),
    };
  }
  const needle = String(word.text ?? "");
  if (!needle) return null;
  const located = locateSpan(text, needle, Math.max(fromOffset, span.start));
  if (!located || located.start >= span.end) return null;
  return { start: located.start, end: Math.min(span.end, located.end) };
}

function assignWordTimings(
  graphemes: ReturnType<typeof displayGraphemes>,
  timings: Array<AlignedChar | undefined>,
  claimedStart: number,
  claimedEnd: number,
  rawStartMs: number,
  rawEndMs: number,
) {
  const claimed = graphemes.filter(
    (grapheme) =>
      grapheme.endOffset > claimedStart && grapheme.startOffset < claimedEnd,
  );
  const spoken = claimed.filter((grapheme) => searchable(grapheme.char));
  const step = (rawEndMs - rawStartMs) / Math.max(1, spoken.length);
  let spokenIndex = 0;
  for (const grapheme of claimed) {
    const at = Math.round(rawStartMs + step * spokenIndex);
    const isSpoken = searchable(grapheme.char).length > 0;
    timings[graphemes.indexOf(grapheme)] = {
      char: grapheme.char,
      startMs: isSpoken ? at : Math.max(rawStartMs, at),
      endMs: isSpoken
        ? Math.max(at + 1, Math.round(rawStartMs + step * (spokenIndex + 1)))
        : at,
      startOffset: grapheme.startOffset,
      endOffset: grapheme.endOffset,
    };
    if (isSpoken) spokenIndex += 1;
  }
}

function linearCharsForGraphemes(
  graphemes: ReturnType<typeof displayGraphemes>,
  startMs: number,
  endMs: number,
): AlignedChar[] {
  const span = Math.max(1, endMs - startMs);
  const spokenCount = graphemes.filter((item) => searchable(item.char)).length;
  if (spokenCount === 0) {
    return graphemes.map((item) => ({
      char: item.char,
      startMs,
      endMs,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
    }));
  }
  const step = span / spokenCount;
  let spokenIndex = 0;
  let lastEnd = startMs;
  return graphemes.map((item) => {
    if (!searchable(item.char)) {
      return {
        char: item.char,
        startMs: lastEnd,
        endMs: lastEnd,
        startOffset: item.startOffset,
        endOffset: item.endOffset,
      };
    }
    const charStart = Math.round(startMs + step * spokenIndex);
    const charEnd = Math.round(startMs + step * (spokenIndex + 1));
    spokenIndex += 1;
    lastEnd = Math.max(charStart + 1, charEnd);
    return {
      char: item.char,
      startMs: charStart,
      endMs: lastEnd,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
    };
  });
}

function completeAlignedChars(
  graphemes: ReturnType<typeof displayGraphemes>,
  timings: Array<AlignedChar | undefined>,
  durationMs: number,
): AlignedChar[] {
  if (graphemes.length === 0) return [];
  const defined = timings
    .map((item, index) => (item ? index : -1))
    .filter((index) => index >= 0);
  if (defined.length === 0) {
    return linearCharsForGraphemes(graphemes, 0, durationMs);
  }

  const filled: AlignedChar[] = [];
  for (let index = 0; index < graphemes.length; index += 1) {
    const existing = timings[index];
    if (existing) {
      filled.push(existing);
      continue;
    }
    let prev = -1;
    for (const candidate of defined) {
      if (candidate < index) prev = candidate;
      else break;
    }
    const next = defined.find((candidate) => candidate > index) ?? -1;
    const gapStart = prev >= 0 ? prev + 1 : 0;
    const gapEnd = next >= 0 ? next : graphemes.length;
    const startMs = prev >= 0 ? timings[prev]!.endMs : 0;
    const endMs = next >= 0 ? timings[next]!.startMs : durationMs;
    const gap = linearCharsForGraphemes(
      graphemes.slice(gapStart, gapEnd),
      startMs,
      Math.max(startMs + 1, endMs),
    );
    filled.push(gap[index - gapStart]!);
  }
  return filled;
}

function alignQwenWordsToText(
  text: string,
  sentences: QwenSentence[],
  timeScale = 1,
): Array<AlignedChar | undefined> {
  const graphemes = displayGraphemes(text);
  const timings: Array<AlignedChar | undefined> = Array(graphemes.length);
  let searchOffset = 0;
  let previousSentenceEndMs = 0;

  for (const sentence of sentences) {
    const validWords = sentence.words.filter((word) => {
      const begin = qwenWordTimeMs(word.begin_time, timeScale);
      const end = qwenWordTimeMs(word.end_time, timeScale);
      return (
        typeof word.text === "string" &&
        Number.isFinite(begin) &&
        Number.isFinite(end) &&
        end > begin
      );
    });
    if (!validWords.length) continue;
    const source =
      sentence.originalText ??
      validWords.map((word) => String(word.text)).join("");
    const span = locateSpan(text, source, searchOffset);
    if (!span) continue;
    searchOffset = span.end;
    const rawFirst = qwenWordTimeMs(validWords[0]!.begin_time, timeScale);
    const rawLast = Math.max(
      ...validWords.map((word) => qwenWordTimeMs(word.end_time, timeScale)),
    );
    // The HTTP API documents absolute audio times. Keep a defensive offset
    // for vendor responses that reset timestamps at each sentence.
    const timeOffset =
      rawFirst < previousSentenceEndMs ? previousSentenceEndMs : 0;
    let wordSearch = span.start;
    for (const word of validWords) {
      const wordSpan = wordSpanInSentence(text, word, span, wordSearch);
      if (!wordSpan) continue;
      wordSearch = wordSpan.end;
      assignWordTimings(
        graphemes,
        timings,
        wordSpan.start,
        wordSpan.end,
        qwenWordTimeMs(word.begin_time, timeScale) + timeOffset,
        qwenWordTimeMs(word.end_time, timeScale) + timeOffset,
      );
    }
    previousSentenceEndMs = Math.max(
      previousSentenceEndMs,
      rawLast + timeOffset,
    );
  }

  return timings;
}

function alignedDuration(
  audio: Buffer,
  sentences: QwenSentence[],
  text: string,
): { durationMs: number; chars: AlignedChar[] } {
  const audioDuration = mp3DurationMs(audio);
  const timeScale = qwenTimestampScaleMs(sentences, audioDuration);
  const graphemes = displayGraphemes(text);
  const timings = alignQwenWordsToText(text, sentences, timeScale);
  const defined = timings.filter((item): item is AlignedChar => Boolean(item));
  const timingDuration = defined.length
    ? Math.max(...defined.map((item) => item.endMs))
    : 0;
  const durationMs = Math.max(1, audioDuration, timingDuration);
  return {
    durationMs,
    chars: completeAlignedChars(graphemes, timings, durationMs),
  };
}

function mp3DurationMs(audio: Buffer): number {
  return Math.round(
    parseMp3Frames(audio).reduce((total, frame) => total + frame.durationMs, 0),
  );
}

async function synthesizeQwenStream(
  text: string,
  options: QwenTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<QwenStreamResult> {
  const env = getEnv();
  const apiKey = env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) throw new Error("Qwen audio is not configured");
  const model = options.model?.trim() || QWEN_AUDIO_TTS_MODEL;
  const voice = options.voiceId?.trim() || QWEN_AUDIO_TTS_VOICE;
  const requestId = randomUUID();
  const effectiveSignal = signal ?? AbortSignal.timeout(90_000);
  const response = await fetch(qwenAudioTtsUrl(model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "enable",
      "X-DashScope-Request-Id": requestId,
    },
    body: JSON.stringify(buildRequest(text, options, model, voice)),
    signal: effectiveSignal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Qwen audio API HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  return readQwenStream(response, effectiveSignal, model);
}

export async function synthesizeQwenTimedSpeech(
  text: string,
  options: QwenTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<QwenTimedSpeech> {
  const cleaned = text.trim();
  if (!cleaned) throw new Error("No speech text provided");
  const started = Date.now();
  const operation = options.logOperation ?? "tts.speech";
  const model = options.model?.trim() || QWEN_AUDIO_TTS_MODEL;
  const voice = options.voiceId?.trim() || QWEN_AUDIO_TTS_VOICE;
  const logRequest = requestLog(cleaned, options, model, voice);
  try {
    const result = await synthesizeQwenStream(cleaned, options, signal);
    const resolved = alignedDuration(result.audio, result.sentences, cleaned);
    const providerCharCount = resolved.chars.length;
    if (options.requireWordTimings && providerCharCount === 0) {
      throw new Error("Qwen audio API returned no usable word timings");
    }
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "success",
      durationMs: Date.now() - started,
      request: logRequest,
      response: {
        requestId: result.requestId,
        audioBytes: result.audio.length,
        sentenceCount: result.sentences.length,
        characterTimingCount: providerCharCount,
        billedCharacters: result.billedCharacters,
      },
      meta: options.logMeta,
    });
    return {
      audio: result.audio,
      mimeType: "audio/mpeg",
      durationMs: resolved.durationMs,
      chars: resolved.chars.map(({ char, startMs, endMs }) => ({
        char,
        startMs,
        endMs,
      })),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "error",
      durationMs: Date.now() - started,
      request: logRequest,
      error: message,
      meta: options.logMeta,
    }).catch(() => undefined);
    throw error;
  }
}

export async function synthesizeQwenSpeech(
  text: string,
  options: QwenTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<QwenTimedSpeech> {
  return synthesizeQwenTimedSpeech(text, options, signal);
}

export async function synthesizeQwenSegmentedSpeech(
  segments: string[],
  options: QwenTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<QwenTimedSpeechBatch> {
  const cleaned = segments.map((segment) => segment.trim());
  if (cleaned.length === 0 || cleaned.some((segment) => !segment)) {
    throw new Error("No speech segments provided");
  }
  const combined = cleaned.join("\n\n");
  const started = Date.now();
  const operation = options.logOperation ?? "tts.speech_segmented";
  const model = options.model?.trim() || QWEN_AUDIO_TTS_MODEL;
  const voice = options.voiceId?.trim() || QWEN_AUDIO_TTS_VOICE;
  const logRequest = requestLog(combined, options, model, voice);
  try {
    const result = await synthesizeQwenStream(
      combined,
      {
        ...options,
        requireWordTimings: false,
        logOperation: operation,
      },
      signal,
    );
    const resolved = alignedDuration(result.audio, result.sentences, combined);
    const durationMs = resolved.durationMs;
    const totalLength = Math.max(1, [...combined].length);
    const boundaries: Array<{ start: number; end: number }> = [];
    let offset = 0;
    for (const segment of cleaned) {
      boundaries.push({ start: offset, end: offset + segment.length });
      offset += segment.length + 2;
    }
    const aligned = resolved.chars;
    const fallbackDurations = cleaned.map((segment) =>
      Math.max(1, Math.round((durationMs * [...segment].length) / totalLength)),
    );
    let fallbackStart = 0;
    const output: QwenTimedSpeechBatch = {
      audio: result.audio,
      mimeType: "audio/mpeg",
      durationMs,
      segments: cleaned.map((segment, index) => {
        const boundary = boundaries[index]!;
        const chars = aligned
          .filter(
            (item) =>
              item.endOffset > boundary.start &&
              item.startOffset < boundary.end,
          )
          .map(({ char, startMs, endMs }) => ({ char, startMs, endMs }));
        if (chars.length > 0) {
          const startMs = Math.max(
            0,
            Math.min(...chars.map((item) => item.startMs)),
          );
          const endMs = Math.max(
            startMs + 1,
            Math.max(...chars.map((item) => item.endMs)),
          );
          return {
            text: segment,
            startMs,
            endMs,
            durationMs: endMs - startMs,
            chars,
          };
        }
        const startMs = fallbackStart;
        const endMs = Math.min(durationMs, startMs + fallbackDurations[index]!);
        fallbackStart = endMs;
        return {
          text: segment,
          startMs,
          endMs: Math.max(startMs + 1, endMs),
          durationMs: Math.max(1, endMs - startMs),
          chars: linearHighlightCharsForText(
            segment,
            0,
            Math.max(1, endMs - startMs),
          ),
        };
      }),
    };
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "success",
      durationMs: Date.now() - started,
      request: logRequest,
      response: {
        requestId: result.requestId,
        audioBytes: result.audio.length,
        sentenceCount: result.sentences.length,
        segmentCount: output.segments.length,
        characterTimingCount: aligned.length,
        billedCharacters: result.billedCharacters,
      },
      meta: options.logMeta,
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "error",
      durationMs: Date.now() - started,
      request: logRequest,
      error: message,
      meta: options.logMeta,
    }).catch(() => undefined);
    throw error;
  }
}
