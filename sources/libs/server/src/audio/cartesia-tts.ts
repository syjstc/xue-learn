import { getEnv } from "../env.js";
import { logLlmRequest } from "../llm/logger.js";
import { parseMp3Frames } from "./mp3-slice.js";
import { linearHighlightCharsForText } from "./minimax-subtitles.js";
import { encodePcmS16leToMp3 } from "./pcm-mp3.js";

export const CARTESIA_TTS_MODEL = "sonic-3.6";
export const CARTESIA_TTS_VOICE = "a1740ddf-75ec-4848-87eb-1ede58638baf";
export const CARTESIA_TTS_VERSION = "2026-08-14";
export const CARTESIA_TTS_SAMPLE_RATE = 44_100;
export const CARTESIA_TTS_TIMING_VERSION =
  "cartesia-sonic-3.6-sse-word-ms-v3";

export type CartesiaTtsRequestOptions = {
  voiceId?: string;
  model?: string;
  /** ISO-639-1 language or a regional locale such as `zh-CN`. */
  languageHint?: string;
  /** Cartesia generation speed; values outside the provider range are clamped. */
  rate?: number;
  /** Shared TTS option expressed as the existing 0-100 volume scale. */
  volume?: number;
  requireWordTimings?: boolean;
  logOperation?: string;
  logMeta?: Record<string, unknown>;
};

export type CartesiaTimedSpeech = {
  audio: Buffer;
  mimeType: "audio/mpeg";
  durationMs: number;
  chars: Array<{ char: string; startMs: number; endMs: number }>;
};

export type CartesiaTimedSpeechSegment = {
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  chars: Array<{ char: string; startMs: number; endMs: number }>;
};

export type CartesiaTimedSpeechBatch = {
  audio: Buffer;
  mimeType: "audio/mpeg";
  durationMs: number;
  segments: CartesiaTimedSpeechSegment[];
};

type CartesiaWord = {
  word: string;
  startMs: number;
  endMs: number;
};

type AlignedChar = {
  char: string;
  startMs: number;
  endMs: number;
  startOffset: number;
  endOffset: number;
};

type CartesiaSseResult = {
  pcm: Buffer;
  words: CartesiaWord[];
};

function clamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function cartesiaTtsSseUrl(): string {
  const env = getEnv();
  const base = new URL(env.CARTESIA_BASE_URL);
  base.pathname = `${base.pathname.replace(/\/$/u, "")}/tts/sse`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function isChineseHint(languageHint?: string): boolean {
  return /^zh(?:-|$)/iu.test(languageHint?.trim() ?? "");
}

const ISOLATED_DIGIT_HAN: Record<string, string> = {
  "0": "零",
  "1": "一",
  "2": "二",
  "3": "三",
  "4": "四",
  "5": "五",
  "6": "六",
  "7": "七",
  "8": "八",
  "9": "九",
};

function shouldKeepArabicDigit(
  source: string,
  offset: number,
  match: string,
): boolean {
  const before = source.slice(0, offset);
  const after = source.slice(offset + match.length);
  const prev = before.at(-1);
  const prevPrev = before.at(-2);
  const next = after[0];
  const nextNext = after[1];
  if (prev !== undefined && /\d/u.test(prev)) return true;
  if (
    prev !== undefined &&
    /[.,，．]/u.test(prev) &&
    prevPrev !== undefined &&
    /\d/u.test(prevPrev)
  ) {
    return true;
  }
  if (next !== undefined && /\d/u.test(next)) return true;
  if (
    next !== undefined &&
    /[.,，．]/u.test(next) &&
    nextNext !== undefined &&
    /\d/u.test(nextNext)
  ) {
    return true;
  }
  return false;
}

/**
 * Keep the learner-facing narration unchanged while making the small amount
 * of provider-specific Chinese read-out repair that the classroom voice needs.
 * Cartesia's normalizer remains enabled for all other numbers and symbols.
 */
export function normalizeCartesiaTranscript(
  text: string,
  languageHint?: string,
): { text: string; transforms: string[] } {
  let normalized = text;
  const transforms: string[] = [];
  if (isChineseHint(languageHint)) {
    // Isolated digits must be spoken as 零/一/二… so Sonic does not read
    // classroom `2` as 两. Do not send `normalization: off`; that truncates
    // Chinese SSE audio. Leave Cartesia's normalizer on for decimals and
    // larger numbers.
    const chineseDigits = normalized.replace(
      /[0-9０-９]/gu,
      (match, offset, source) => {
        if (shouldKeepArabicDigit(source, offset, match)) return match;
        const digit = match.normalize("NFKC");
        const han = ISOLATED_DIGIT_HAN[digit] ?? match;
        const prev = source[offset - 1];
        const next = source[offset + match.length];
        const lead = prev && /[A-Za-z=]/u.test(prev) ? " " : "";
        const tail =
          next && /[\u4e00-\u9fffA-Za-z]/u.test(next) ? " " : "";
        return `${lead}${han}${tail}`;
      },
    );
    if (chineseDigits !== normalized) transforms.push("chinese_isolated_digits");
    normalized = chineseDigits;
  }
  // Cartesia recommends terminal punctuation for complete transcripts.
  const terminal = normalized.replace(/(?:…+|\.{3,})$/u, "。");
  if (terminal !== normalized) transforms.push("terminal_ellipsis_to_period");
  return { text: terminal, transforms };
}

function spokenCharacterCount(text: string): number {
  return [...text].filter(
    (char) =>
      !/\s/u.test(char) &&
      !/[，。！？、；：,.!?;:…—\-()[\]（）「」『』“”"'‘’《》<>]/u.test(char),
  ).length;
}

function minimumCartesiaDurationMs(text: string): number {
  const count = spokenCharacterCount(text);
  return count > 0 ? Math.max(250, count * 35) : 0;
}

function buildRequest(
  text: string,
  options: CartesiaTtsRequestOptions,
  model: string,
  voice: string,
): Record<string, unknown> {
  const providerTranscript = normalizeCartesiaTranscript(
    text,
    options.languageHint,
  );
  const body: Record<string, unknown> = {
    model_id: model,
    transcript: providerTranscript.text,
    voice,
    output_format: {
      container: "raw",
      encoding: "pcm_s16le",
      sample_rate: CARTESIA_TTS_SAMPLE_RATE,
    },
    add_timestamps: true,
    use_normalized_timestamps: false,
  };
  const language = options.languageHint?.trim();
  if (language) {
    if (/^[a-z]{2}$/iu.test(language)) body.language = language;
    else body.locale = language;
  }
  body.generation_config = {
    speed: clamp(options.rate, 0.6, 1.5, 1.2),
    volume: clamp(
      options.volume !== undefined ? options.volume / 50 : 1.2,
      0.5,
      2,
      1.2,
    ),
  };
  return body;
}

function requestLog(
  text: string,
  options: CartesiaTtsRequestOptions,
  model: string,
  voice: string,
) {
  const providerTranscript = normalizeCartesiaTranscript(
    text,
    options.languageHint,
  );
  return {
    provider: "cartesia",
    model,
    voice,
    textLength: text.length,
    textPreview: text.slice(0, 500),
    providerTranscriptLength: providerTranscript.text.length,
    providerTranscriptPreview: providerTranscript.text.slice(0, 500),
    transcriptTransform: providerTranscript.transforms.join("+") || "none",
    format: "pcm_s16le",
    sampleRate: CARTESIA_TTS_SAMPLE_RATE,
    language: options.languageHint?.trim() || null,
    wordTimestampEnabled: true,
    timingFallback: "linear_grapheme",
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
  return value
    .normalize("NFKC")
    .replace(/[两兩贰貳]/gu, "二")
    .replace(/[0-9]/gu, (digit) => ISOLATED_DIGIT_HAN[digit] ?? digit)
    .replace(/\s+/gu, "")
    .toLocaleLowerCase();
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

function wordTimeMs(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  // Cartesia documents start/end as seconds. Values past 20s used to be
  // mistaken for milliseconds, which pinned late caption characters at ~20ms.
  return Math.round(numeric * 1000);
}

export function alignCartesiaWordsToText(
  text: string,
  words: CartesiaWord[],
  durationMs: number,
): AlignedChar[] {
  const graphemes = displayGraphemes(text);
  if (graphemes.length === 0) return [];
  const timings: Array<AlignedChar | undefined> = Array(graphemes.length);
  let searchOffset = 0;

  for (const word of words) {
    if (!word.word.trim() || word.endMs <= word.startMs) continue;
    const span = locateSpan(text, word.word, searchOffset);
    if (!span) continue;
    searchOffset = span.end;
    const claimed = graphemes.filter(
      (grapheme) =>
        grapheme.endOffset > span.start && grapheme.startOffset < span.end,
    );
    const spoken = claimed.filter((grapheme) => searchable(grapheme.char));
    const step =
      (word.endMs - word.startMs) / Math.max(1, spoken.length);
    let spokenIndex = 0;
    for (const grapheme of claimed) {
      const isSpoken = searchable(grapheme.char).length > 0;
      const at = Math.round(word.startMs + step * spokenIndex);
      timings[graphemes.indexOf(grapheme)] = {
        char: grapheme.char,
        startMs: isSpoken ? at : Math.max(word.startMs, at),
        endMs: isSpoken
          ? Math.max(at + 1, Math.round(word.startMs + step * (spokenIndex + 1)))
          : at,
        startOffset: grapheme.startOffset,
        endOffset: grapheme.endOffset,
      };
      if (isSpoken) spokenIndex += 1;
    }
  }

  const fillRange = (
    startIndex: number,
    endIndex: number,
    startMs: number,
    endMs: number,
  ) => {
    const span = Math.max(1, endMs - startMs);
    const count = endIndex - startIndex;
    for (let index = startIndex; index < endIndex; index += 1) {
      if (timings[index]) continue;
      const grapheme = graphemes[index]!;
      const local = index - startIndex;
      const charStart = Math.round(startMs + (span * local) / Math.max(1, count));
      const charEnd = Math.round(
        startMs + (span * (local + 1)) / Math.max(1, count),
      );
      timings[index] = {
        char: grapheme.char,
        startMs: charStart,
        endMs: Math.max(charStart + 1, charEnd),
        startOffset: grapheme.startOffset,
        endOffset: grapheme.endOffset,
      };
    }
  };

  let cursor = 0;
  while (cursor < graphemes.length) {
    if (timings[cursor]) {
      cursor += 1;
      continue;
    }
    let gapEnd = cursor;
    while (gapEnd < graphemes.length && !timings[gapEnd]) gapEnd += 1;
    const prev = cursor > 0 ? timings[cursor - 1] : undefined;
    const next = gapEnd < graphemes.length ? timings[gapEnd] : undefined;
    fillRange(
      cursor,
      gapEnd,
      prev?.endMs ?? 0,
      next?.startMs ?? Math.max(durationMs, prev?.endMs ?? 0),
    );
    cursor = gapEnd;
  }

  return timings.filter((item): item is AlignedChar => Boolean(item));
}

function scaleAlignedChars(
  chars: AlignedChar[],
  fromDurationMs: number,
  toDurationMs: number,
): AlignedChar[] {
  if (
    fromDurationMs <= 0 ||
    toDurationMs <= 0 ||
    Math.abs(fromDurationMs - toDurationMs) < 8
  ) {
    return chars;
  }
  const scale = toDurationMs / fromDurationMs;
  return chars.map((item) => ({
    ...item,
    startMs: Math.round(item.startMs * scale),
    endMs: Math.max(
      Math.round(item.startMs * scale) + 1,
      Math.round(item.endMs * scale),
    ),
  }));
}

function partitionSilence(segments: CartesiaTimedSpeechSegment[], durationMs: number) {
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
    last.endMs = Math.max(last.endMs, durationMs);
    last.durationMs = Math.max(1, last.endMs - last.startMs);
  }
  for (const segment of segments) {
    if (!segment.chars.length) continue;
    segment.chars[0]!.startMs = segment.startMs;
    segment.chars.at(-1)!.endMs = segment.endMs;
  }
}

function segmentsFromAlignedChars(
  cleaned: string[],
  combined: string,
  aligned: AlignedChar[],
  durationMs: number,
): CartesiaTimedSpeechSegment[] {
  const totalLength = Math.max(1, [...combined].length);
  const boundaries: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const segment of cleaned) {
    boundaries.push({ start: offset, end: offset + segment.length });
    offset += segment.length + 2;
  }
  const fallbackDurations = cleaned.map((segment) =>
    Math.max(1, Math.round((durationMs * [...segment].length) / totalLength)),
  );
  let fallbackStart = 0;
  const segments = cleaned.map((segment, index) => {
    const boundary = boundaries[index]!;
    const chars = aligned
      .filter(
        (item) =>
          item.endOffset > boundary.start && item.startOffset < boundary.end,
      )
      .map(({ char, startMs, endMs }) => ({ char, startMs, endMs }));
    if (chars.length > 0) {
      const startMs = Math.max(0, Math.min(...chars.map((item) => item.startMs)));
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
        startMs,
        Math.max(startMs + 1, endMs),
      ),
    };
  });
  if (aligned.length > 0) partitionSilence(segments, durationMs);
  return segments;
}

function parseSseBlock(block: string): Record<string, unknown> | null {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    throw new Error("Cartesia TTS API returned an invalid SSE event");
  }
}

function decodeChunkAudio(value: unknown): Buffer | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const audio = Buffer.from(value, "base64");
    return audio.length > 0 ? audio : null;
  } catch {
    return null;
  }
}

function collectWords(event: Record<string, unknown>): CartesiaWord[] {
  const payload =
    event.word_timestamps && typeof event.word_timestamps === "object"
      ? (event.word_timestamps as Record<string, unknown>)
      : event;
  const words = Array.isArray(payload.words) ? payload.words : [];
  const starts = Array.isArray(payload.start) ? payload.start : [];
  const ends = Array.isArray(payload.end) ? payload.end : [];
  const collected: CartesiaWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const startMs = wordTimeMs(starts[index]);
    const endMs = wordTimeMs(ends[index]);
    if (typeof word !== "string" || !word || startMs == null || endMs == null) {
      continue;
    }
    collected.push({
      word,
      startMs,
      endMs: Math.max(startMs + 1, endMs),
    });
  }
  return collected;
}

async function readCartesiaSse(
  response: Response,
): Promise<CartesiaSseResult> {
  if (!response.body) throw new Error("Cartesia TTS API returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const pcmParts: Buffer[] = [];
  const words: CartesiaWord[] = [];

  const consume = (block: string) => {
    const event = parseSseBlock(block);
    if (!event) return;
    const type = event.type;
    if (type === "error") {
      const title = typeof event.title === "string" ? event.title : "error";
      const message =
        typeof event.message === "string" ? event.message : "unknown";
      throw new Error(`Cartesia TTS API ${title}: ${message}`);
    }
    if (type === "chunk") {
      const part = decodeChunkAudio(event.data);
      if (part) pcmParts.push(part);
      return;
    }
    if (type === "timestamps") {
      words.push(...collectWords(event));
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

  const pcm = Buffer.concat(pcmParts);
  if (!pcm.length) throw new Error("Cartesia TTS API returned empty audio");
  return { pcm, words };
}

function pcmDurationMs(pcm: Buffer): number {
  return Math.round((pcm.length / 2 / CARTESIA_TTS_SAMPLE_RATE) * 1000);
}

function mp3DurationMs(audio: Buffer): number {
  return Math.round(
    parseMp3Frames(audio).reduce((total, frame) => total + frame.durationMs, 0),
  );
}

async function synthesizeCartesiaSse(
  text: string,
  options: CartesiaTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<{
  audio: Buffer;
  durationMs: number;
  words: CartesiaWord[];
  pcmDurationMs: number;
}> {
  const env = getEnv();
  const apiKey = env.CARTESIA_API_KEY?.trim();
  if (!apiKey) throw new Error("Cartesia TTS is not configured");
  const model = options.model?.trim() || CARTESIA_TTS_MODEL;
  const voice = options.voiceId?.trim() || CARTESIA_TTS_VOICE;
  const effectiveSignal = signal ?? AbortSignal.timeout(90_000);
  const response = await fetch(cartesiaTtsSseUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cartesia-Version": env.CARTESIA_VERSION,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(buildRequest(text, options, model, voice)),
    signal: effectiveSignal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Cartesia TTS API HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  const streamed = await readCartesiaSse(response);
  const pcmMs = pcmDurationMs(streamed.pcm);
  const minimumDurationMs = minimumCartesiaDurationMs(text);
  if (minimumDurationMs > 0 && pcmMs < minimumDurationMs) {
    throw new Error(
      `Cartesia TTS API returned suspiciously short audio (${streamed.pcm.length} bytes, ${pcmMs}ms PCM for ${spokenCharacterCount(text)} spoken characters; expected at least ${minimumDurationMs}ms)`,
    );
  }
  const audio = await encodePcmS16leToMp3(streamed.pcm, CARTESIA_TTS_SAMPLE_RATE);
  const encodedMs = mp3DurationMs(audio);
  if (encodedMs <= 0) {
    throw new Error(
      `Cartesia TTS MP3 encode was undecodable (${audio.length} bytes from ${streamed.pcm.length} bytes PCM)`,
    );
  }
  return {
    audio,
    durationMs: Math.max(1, encodedMs, pcmMs),
    words: streamed.words,
    pcmDurationMs: pcmMs,
  };
}

function resolveAlignedChars(
  text: string,
  words: CartesiaWord[],
  durationMs: number,
  pcmDurationMsValue: number,
  requireWordTimings: boolean | undefined,
): AlignedChar[] {
  const timingDuration = Math.max(
    1,
    pcmDurationMsValue,
    ...words.map((word) => word.endMs),
  );
  const aligned = alignCartesiaWordsToText(text, words, timingDuration);
  if (requireWordTimings && aligned.length === 0) {
    throw new Error("Cartesia SSE endpoint returned no usable word timings");
  }
  if (aligned.length === 0) {
    return linearHighlightCharsForText(text, 0, durationMs).map(
      (item, index) => ({
        ...item,
        startOffset: index,
        endOffset: index + item.char.length,
      }),
    );
  }
  return scaleAlignedChars(aligned, timingDuration, durationMs);
}

export async function synthesizeCartesiaTimedSpeech(
  text: string,
  options: CartesiaTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<CartesiaTimedSpeech> {
  const cleaned = text.trim();
  if (!cleaned) throw new Error("No speech text provided");
  const started = Date.now();
  const operation = options.logOperation ?? "tts.speech";
  const model = options.model?.trim() || CARTESIA_TTS_MODEL;
  const voice = options.voiceId?.trim() || CARTESIA_TTS_VOICE;
  const logRequest = requestLog(cleaned, options, model, voice);
  try {
    const result = await synthesizeCartesiaSse(cleaned, options, signal);
    const chars = resolveAlignedChars(
      cleaned,
      result.words,
      result.durationMs,
      result.pcmDurationMs,
      options.requireWordTimings,
    );
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "success",
      durationMs: Date.now() - started,
      request: logRequest,
      response: {
        audioBytes: result.audio.length,
        audioContentType: "audio/mpeg",
        audioDurationMs: result.durationMs,
        wordCount: result.words.length,
        characterTimingCount: chars.length,
      },
      meta: options.logMeta,
    });
    return {
      audio: result.audio,
      mimeType: "audio/mpeg",
      durationMs: result.durationMs,
      chars: chars.map(({ char, startMs, endMs }) => ({
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

export async function synthesizeCartesiaSpeech(
  text: string,
  options: CartesiaTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<CartesiaTimedSpeech> {
  return synthesizeCartesiaTimedSpeech(text, options, signal);
}

export async function synthesizeCartesiaSegmentedSpeech(
  segments: string[],
  options: CartesiaTtsRequestOptions = {},
  signal?: AbortSignal,
): Promise<CartesiaTimedSpeechBatch> {
  const cleaned = segments.map((segment) => segment.trim());
  if (cleaned.length === 0 || cleaned.some((segment) => !segment)) {
    throw new Error("No speech segments provided");
  }
  const combined = cleaned.join("\n\n");
  const started = Date.now();
  const operation = options.logOperation ?? "tts.speech_segmented";
  const model = options.model?.trim() || CARTESIA_TTS_MODEL;
  const voice = options.voiceId?.trim() || CARTESIA_TTS_VOICE;
  const logRequest = requestLog(combined, options, model, voice);
  try {
    const result = await synthesizeCartesiaSse(
      combined,
      { ...options, logOperation: operation },
      signal,
    );
    const aligned = resolveAlignedChars(
      combined,
      result.words,
      result.durationMs,
      result.pcmDurationMs,
      options.requireWordTimings,
    );
    const output: CartesiaTimedSpeechBatch = {
      audio: result.audio,
      mimeType: "audio/mpeg",
      durationMs: result.durationMs,
      segments: segmentsFromAlignedChars(
        cleaned,
        combined,
        aligned,
        result.durationMs,
      ),
    };
    await logLlmRequest({
      operation,
      kind: "audio",
      status: "success",
      durationMs: Date.now() - started,
      request: logRequest,
      response: {
        audioBytes: result.audio.length,
        audioContentType: "audio/mpeg",
        audioDurationMs: result.durationMs,
        wordCount: result.words.length,
        segmentCount: output.segments.length,
        characterTimingCount: aligned.length,
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
