import { renderMusicPcm, musicPcmWav } from "./music-audio.js";
import type { MusicPerformancePlan as TimelineMusicInput } from "./music-playback.js";
const note = {
  targetId: "c",
  midi: 60,
  instrument: "piano",
  velocity: 0.6,
  startTick: 0,
  durationTicks: 24_000,
};
const plan: TimelineMusicInput = {
  figureId: "keys",
  clipId: "listen",
  label: "C",
  durationTicks: 48_000,
  notes: [note],
};
const sample = {
  data: Float32Array.from({ length: 96_000 }, (_, i) =>
    Math.sin((i / 48_000) * 261.625565 * Math.PI * 2),
  ),
  midi: 60,
  sampleRate: 48_000,
  sustain: false,
};
test("PCM obeys event duration, leaves the rest silent, and writes a 48 kHz mono WAV", async () => {
  const pcm = await renderMusicPcm(plan, async () => sample);
  expect(pcm).toHaveLength(48_000);
  expect(pcm.slice(500, 23_000).some((v) => Math.abs(v) > 0.1)).toBe(true);
  expect(pcm.slice(24_000).every((v) => v === 0)).toBe(true);
  expect(pcm[23_999]).toBe(0);
  const wav = musicPcmWav(pcm),
    header = new DataView(wav.buffer);
  expect(header.getUint32(24, true)).toBe(48_000);
  expect(header.getUint16(22, true)).toBe(1);
  expect(wav.length).toBe(44 + 96_000);
});
test("a failed sample waits for other owned decodes before rejecting", async () => {
  let completed = false;
  await expect(
    renderMusicPcm(
      { ...plan, notes: [note, { ...note, midi: 64 }] },
      async (_instrument, midi) => {
        if (midi === 60) throw Error("decode failed");
        await new Promise((resolve) => setTimeout(resolve, 10));
        completed = true;
        return sample;
      },
    ),
  ).rejects.toThrow("decode failed");
  expect(completed).toBe(true);
});

test.each([1, 4])(
  "%i simultaneous voices remain clear without clipping or flattening dynamics",
  async (voices) => {
    const pcm = await renderMusicPcm(
      {
        ...plan,
        notes: Array.from({ length: voices }, () => [
          note,
          { ...note, startTick: 24_000, velocity: note.velocity / 2 },
        ]).flat(),
      },
      async () => sample,
    );
    const peak = (values: Float32Array) =>
      values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const loud = peak(pcm.slice(0, 24_000));
    const soft = peak(pcm.slice(24_000));
    expect(loud).toBeGreaterThan(0.7);
    expect(loud).toBeLessThanOrEqual(0.950001);
    expect(soft / loud).toBeCloseTo(0.5, 5);
    expect(pcm[0]).toBe(0);
    expect(pcm[23_999]).toBe(0);
    expect(pcm[24_000]).toBe(0);
    expect(pcm[47_999]).toBe(0);
  },
);
