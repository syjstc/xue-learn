import type { MusicPerformancePlan } from "./music-playback.js";

// Teaching performances should remain clear between spoken beats. Apply +15.6 dB
// to the whole clip before peak protection so authored dynamics stay intact.
const MUSIC_MASTER_GAIN = 6;

export type MusicPcmSample = {
  data: Float32Array;
  sampleRate: number;
  midi: number;
  sustain: boolean;
};
export type MusicSampleDecoder = (
  instrument: string,
  midi: number,
) => Promise<MusicPcmSample>;

/** Shared browser/export sampler: identical notes, envelopes, pitch and release boundaries. */
export async function renderMusicPcm(
  plan: MusicPerformancePlan,
  decode: MusicSampleDecoder,
): Promise<Float32Array> {
  const rate = 48_000;
  if (
    !Number.isSafeInteger(plan.durationTicks) ||
    plan.durationTicks <= 0 ||
    plan.durationTicks > rate * 480 ||
    plan.notes.length > 2048
  )
    throw Error("Invalid music render duration or note count");
  const out = new Float32Array(plan.durationTicks);
  const decoded = await Promise.allSettled(
    plan.notes.map((note) => decode(note.instrument, note.midi)),
  );
  const failure = decoded.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  const samples = decoded.map(
    (result) => (result as PromiseFulfilledResult<MusicPcmSample>).value,
  );
  for (const [index, note] of plan.notes.entries()) {
    const sample = samples[index]!,
      data = sample.data;
    if (
      !data.length ||
      !Number.isFinite(sample.sampleRate) ||
      sample.sampleRate <= 0 ||
      !Number.isFinite(note.velocity) ||
      note.velocity < 0 ||
      note.velocity > 1 ||
      !Number.isInteger(note.midi) ||
      note.midi < 21 ||
      note.midi > 108 ||
      !Number.isSafeInteger(note.startTick) ||
      note.startTick < 0 ||
      !Number.isSafeInteger(note.durationTicks) ||
      note.durationTicks < 1 ||
      note.startTick + note.durationTicks > out.length
    )
      throw Error("Invalid music sample or event");
    let peak = 0,
      onset = 0;
    for (const value of data) {
      if (!Number.isFinite(value)) throw Error("Non-finite music sample");
      peak = Math.max(peak, Math.abs(value));
    }
    while (
      onset < Math.min(data.length, sample.sampleRate * 0.08) &&
      Math.abs(data[onset]!) < peak * 0.002
    )
      onset++;
    const crossing = (seconds: number) => {
      let i = Math.min(
        data.length - 2,
        Math.floor(seconds * sample.sampleRate),
      );
      const end = Math.min(data.length - 2, i + sample.sampleRate * 0.04);
      while (i < end && !(data[i]! <= 0 && data[i + 1]! > 0)) i++;
      return i;
    };
    const loopStart = crossing(0.7),
      loopEnd = crossing(1.7),
      step = (sample.sampleRate / rate) * 2 ** ((note.midi - sample.midi) / 12);
    const level = note.velocity * Math.min(6, 0.22 / Math.max(0.025, peak));
    for (let t = 0; t < note.durationTicks; t++) {
      let position = onset + t * step;
      if (sample.sustain && loopEnd > loopStart && position >= loopEnd)
        position = loopStart + ((position - loopStart) % (loopEnd - loopStart));
      if (position >= data.length - 1) break;
      const at = Math.floor(position),
        fraction = position - at;
      const envelope = Math.min(
        1,
        t / (rate * 0.004),
        (note.durationTicks - 1 - t) / (rate * 0.035),
      );
      out[note.startTick + t] +=
        (data[at]! * (1 - fraction) + data[at + 1]! * fraction) *
        level *
        Math.max(0, envelope);
    }
  }
  let peak = 0;
  for (const value of out) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 0 ? Math.min(MUSIC_MASTER_GAIN, 0.95 / peak) : 1;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

export function musicPcmWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2),
    view = new DataView(bytes.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) =>
    view.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, v)) * 32767),
      true,
    ),
  );
  return bytes;
}
