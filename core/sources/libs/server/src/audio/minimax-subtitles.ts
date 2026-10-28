import { stripMinimaxTtsExpressionTags } from "./minimax-tts-model.js";

export type MinimaxSubtitleLine = {
  text: string;
  startMs: number;
  endMs: number;
};

export type SubtitleCharTiming = {
  char: string;
  startMs: number;
  endMs: number;
};

export type TimedSegmentWithChars = {
  text: string;
  startMs: number;
  endMs: number;
  chars: SubtitleCharTiming[];
};

function toMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 1000) return Math.round(value * 1000);
  return Math.round(value);
}

function parseSubtitleEntry(raw: unknown): MinimaxSubtitleLine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text =
    typeof row.text === "string"
      ? row.text
      : typeof row.word === "string"
        ? row.word
        : typeof row.content === "string"
          ? row.content
          : "";
  const startMs =
    toMs(row.start_time) ??
    toMs(row.time_begin) ??
    toMs(row.begin_time) ??
    toMs(row.start) ??
    toMs(row.begin);
  const endMs =
    toMs(row.end_time) ?? toMs(row.time_end) ?? toMs(row.end);
  if (!text.trim() || startMs == null || endMs == null) return null;
  return { text: text.trim(), startMs, endMs };
}

export function parseMinimaxSubtitleJson(raw: unknown): MinimaxSubtitleLine[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((raw as {
          words?: unknown;
          sentences?: unknown;
          data?: unknown;
          subtitle?: unknown;
        }).words ??
        (raw as { sentences?: unknown }).sentences ??
        (raw as { data?: unknown }).data ??
        (raw as { subtitle?: unknown }).subtitle ??
        [])
      : [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map(parseSubtitleEntry)
    .filter((line): line is MinimaxSubtitleLine => line != null);
}

function normalizeText(text: string): string {
  return stripMinimaxTtsExpressionTags(text).replace(/\s+/g, "").toLowerCase();
}

function splitDisplayChars(text: string): string[] {
  return [...stripMinimaxTtsExpressionTags(text)];
}

export function linearHighlightCharsForText(
  text: string,
  startMs: number,
  endMs: number,
): SubtitleCharTiming[] {
  const chars = splitDisplayChars(text);
  if (chars.length === 0) return [];
  const spokenCount = chars.filter((char) => !/\s/u.test(char)).length;
  if (spokenCount === 0) {
    return chars.map((char) => ({ char, startMs, endMs }));
  }

  const duration = Math.max(1, endMs - startMs);
  const step = duration / spokenCount;
  let spokenIndex = 0;
  let lastTime = startMs;

  return chars.map((char) => {
    if (/\s/u.test(char)) {
      return { char, startMs: lastTime, endMs: lastTime };
    }

    const charStartMs = Math.round(startMs + step * spokenIndex);
    const charEndMs = Math.round(startMs + step * (spokenIndex + 1));
    spokenIndex += 1;
    lastTime = charEndMs;
    return { char, startMs: charStartMs, endMs: charEndMs };
  });
}

function fallbackSegmentsWithChars(
  segments: string[],
  totalDurationMs?: number,
): TimedSegmentWithChars[] {
  const duration =
    totalDurationMs ?? Math.max(1, segments.join("").length * 120);
  const weights = segments.map((text) =>
    Math.max(1, splitDisplayChars(text).length),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return segments.map((text, index) => {
    const span = Math.round((duration * weights[index]!) / totalWeight);
    const startMs = cursor;
    const endMs =
      index === segments.length - 1
        ? duration
        : Math.min(duration, startMs + span);
    cursor = endMs;
    return {
      text,
      startMs,
      endMs,
      chars: linearHighlightCharsForText(text, startMs, endMs),
    };
  });
}

/** Map MiniMax sentence subtitles onto narration segments with local linear char timings. */
export function alignSentenceSubtitlesToSegments(
  segments: string[],
  subtitles: MinimaxSubtitleLine[],
  totalDurationMs?: number,
): TimedSegmentWithChars[] {
  if (segments.length === 0) return [];
  if (subtitles.length === 0) {
    return fallbackSegmentsWithChars(segments, totalDurationMs);
  }

  return alignSubtitlesToSegments(segments, subtitles, totalDurationMs).map(
    (segment) => ({
      ...segment,
      chars: linearHighlightCharsForText(
        segment.text,
        segment.startMs,
        segment.endMs,
      ),
    }),
  );
}

export function alignSubtitlesToSegments(
  segments: string[],
  subtitles: MinimaxSubtitleLine[],
  totalDurationMs?: number,
): MinimaxSubtitleLine[] {
  if (segments.length === 0) return [];
  if (subtitles.length === segments.length) {
    return segments.map((text, index) => ({
      text,
      startMs: subtitles[index]!.startMs,
      endMs: subtitles[index]!.endMs,
    }));
  }

  const aligned: MinimaxSubtitleLine[] = [];
  let subIdx = 0;
  for (const segment of segments) {
    const target = normalizeText(segment);
    let consumed = "";
    const startMs = subtitles[subIdx]?.startMs ?? aligned.at(-1)?.endMs ?? 0;
    let endMs = startMs;
    while (subIdx < subtitles.length) {
      const line = subtitles[subIdx]!;
      consumed += normalizeText(line.text);
      endMs = line.endMs;
      subIdx += 1;
      if (!target || consumed.length >= target.length) break;
    }
    aligned.push({ text: segment, startMs, endMs });
  }

  if (
    aligned.length === segments.length &&
    aligned.every((line) => line.endMs > line.startMs)
  ) {
    return aligned;
  }

  const duration =
    totalDurationMs ??
    subtitles.at(-1)?.endMs ??
    Math.max(1, segments.join("").length * 120);
  const weights = segments.map((text) => Math.max(1, text.trim().length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return segments.map((text, index) => {
    const span = Math.round((duration * weights[index]!) / totalWeight);
    const startMs = cursor;
    const endMs =
      index === segments.length - 1 ? duration : Math.min(duration, startMs + span);
    cursor = endMs;
    return { text, startMs, endMs };
  });
}
