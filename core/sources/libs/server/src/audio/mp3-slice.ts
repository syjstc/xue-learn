export type Mp3Frame = {
  offset: number;
  length: number;
  durationMs: number;
  sampleRate: number;
  bitrateKbps: number;
};

// Bitrate lookup table (kbps) [version_layer][bitrate_index]
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

const SAMPLE_RATES_V1 = [44100, 48000, 32000, 0];
const SAMPLE_RATES_V2 = [22050, 24000, 16000, 0];
const SAMPLE_RATES_V25 = [11025, 12000, 8000, 0];

/**
 * Parses all valid MPEG Audio frames from an MP3 buffer.
 * Automatically skips ID3v2 headers if present.
 */
export function parseMp3Frames(buffer: Buffer): Mp3Frame[] {
  const frames: Mp3Frame[] = [];
  let offset = 0;
  const length = buffer.length;

  // Skip ID3v2 header if present (starts with "ID3")
  if (
    length >= 10 &&
    buffer[0] === 0x49 && // 'I'
    buffer[1] === 0x44 && // 'D'
    buffer[2] === 0x33    // '3'
  ) {
    const size =
      ((buffer[6]! & 0x7f) << 21) |
      ((buffer[7]! & 0x7f) << 14) |
      ((buffer[8]! & 0x7f) << 7) |
      (buffer[9]! & 0x7f);
    offset = 10 + size;
  }

  while (offset < length - 4) {
    // Check for sync word 0xFFE0
    if (buffer[offset] !== 0xff || (buffer[offset + 1]! & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }

    const b1 = buffer[offset + 1]!;
    const b2 = buffer[offset + 2]!;

    const versionBits = (b1 >> 3) & 0x03;
    const layerBits = (b1 >> 1) & 0x03;
    const bitrateIdx = (b2 >> 4) & 0x0f;
    const sampleRateIdx = (b2 >> 2) & 0x03;
    const padding = (b2 >> 1) & 0x01;

    // Reject reserved / invalid combinations
    if (versionBits === 1 || layerBits === 0 || bitrateIdx === 0 || bitrateIdx === 15 || sampleRateIdx === 3) {
      offset += 1;
      continue;
    }

    // Determine version: 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    let sampleRate = 0;
    let samplesPerFrame = 1152;
    if (versionBits === 3) {
      sampleRate = SAMPLE_RATES_V1[sampleRateIdx]!;
      samplesPerFrame = layerBits === 3 ? 384 : 1152;
    } else if (versionBits === 2) {
      sampleRate = SAMPLE_RATES_V2[sampleRateIdx]!;
      samplesPerFrame = layerBits === 3 ? 384 : (layerBits === 1 ? 576 : 1152);
    } else {
      sampleRate = SAMPLE_RATES_V25[sampleRateIdx]!;
      samplesPerFrame = layerBits === 3 ? 384 : (layerBits === 1 ? 576 : 1152);
    }

    if (sampleRate <= 0) {
      offset += 1;
      continue;
    }

    let bitrateKbps = 0;
    if (layerBits === 1) { // Layer III
      bitrateKbps = (versionBits === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIdx] ?? 0;
    } else {
      bitrateKbps = (versionBits === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIdx] ?? 0;
    }

    if (bitrateKbps <= 0) {
      offset += 1;
      continue;
    }

    let frameLen = 0;
    if (layerBits === 3) { // Layer I
      frameLen = Math.floor((samplesPerFrame / 8) * (bitrateKbps * 1000) / sampleRate + padding) * 4;
    } else { // Layer II & III
      frameLen = Math.floor((samplesPerFrame / 8) * (bitrateKbps * 1000) / sampleRate) + padding;
    }

    if (frameLen <= 4 || offset + frameLen > length) {
      offset += 1;
      continue;
    }

    const durationMs = (samplesPerFrame / sampleRate) * 1000;
    frames.push({
      offset,
      length: frameLen,
      durationMs,
      sampleRate,
      bitrateKbps,
    });

    offset += frameLen;
  }

  return frames;
}

/**
 * Slices an MP3 buffer along MP3 frame boundaries corresponding to [startMs, endMs].
 * Returns a valid, decodable standalone MP3 buffer for that time range.
 */
export function sliceMp3Frames(
  buffer: Buffer,
  startMs: number,
  endMs: number,
): { buffer: Buffer; actualDurationMs: number } {
  if (buffer.length === 0) {
    return { buffer, actualDurationMs: 0 };
  }

  const frames = parseMp3Frames(buffer);
  if (frames.length === 0) {
    return { buffer, actualDurationMs: Math.max(0, endMs - startMs) };
  }

  const targetStart = Math.max(0, startMs);
  const targetEnd = Math.max(targetStart, endMs);

  let currentTimeMs = 0;
  let firstIndex = -1;
  let lastIndex = -1;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const frameStart = currentTimeMs;
    const frameEnd = currentTimeMs + frame.durationMs;

    // Check if this frame overlaps [targetStart, targetEnd]
    // Or if it's the frame containing targetStart
    if (firstIndex === -1 && (frameEnd > targetStart || i === frames.length - 1)) {
      firstIndex = i;
    }
    if (firstIndex !== -1 && (frameStart < targetEnd || i === firstIndex)) {
      lastIndex = i;
    }

    currentTimeMs = frameEnd;
  }

  if (firstIndex === -1) firstIndex = 0;
  if (lastIndex === -1 || lastIndex < firstIndex) lastIndex = firstIndex;

  const firstFrame = frames[firstIndex]!;
  const lastFrame = frames[lastIndex]!;
  const startByte = firstFrame.offset;
  const endByte = lastFrame.offset + lastFrame.length;

  let actualDurationMs = 0;
  for (let i = firstIndex; i <= lastIndex; i++) {
    actualDurationMs += frames[i]!.durationMs;
  }

  return {
    buffer: buffer.subarray(startByte, endByte),
    actualDurationMs: Math.round(actualDurationMs),
  };
}
