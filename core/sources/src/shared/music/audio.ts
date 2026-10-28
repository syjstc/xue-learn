import {
  musicPerformance,
  type MusicInstrument,
  type MusicPlan,
  type MusicSelection,
} from "../../../libs/domain/src/index.js";
import { claimMusicAudio, releaseMusicAudio } from "./audio-ownership.js";

type Preset = {
  id: string;
  sustain: boolean;
  samples: { midi: number; data: string }[];
};
type Sample = {
  buffer: AudioBuffer;
  peak: number;
  offset: number;
  loopStart: number;
  loopEnd: number;
  rate: number;
  sustain: boolean;
};
let catalog: Promise<Preset[]> | undefined;
const decoded = new Map<string, Promise<Omit<Sample, "rate" | "sustain">>>();
let activePlayer: MusicPlayer | undefined;
export const MUSIC_LABELS: Record<MusicInstrument, string> = {
  piano: "钢琴",
  electric_piano: "电钢琴",
  guitar: "尼龙弦吉他",
  violin: "小提琴",
  cello: "大提琴",
  flute: "长笛",
  marimba: "马林巴",
  organ: "管风琴",
};
export async function loadMusicSample(
  context: BaseAudioContext,
  instrument: MusicInstrument,
  midi: number,
): Promise<Sample> {
  const presets = await (catalog ??= import("./assets/instruments.json")
    .then((m) => m.default)
    .catch((error) => {
      catalog = undefined;
      throw error;
    }));
  const preset = presets.find((p) => p.id === instrument)!;
  const sample = preset.samples.reduce((best, next) =>
    Math.abs(next.midi - midi) < Math.abs(best.midi - midi) ? next : best,
  );
  const key = `${instrument}:${sample.midi}:${context.sampleRate}`;
  if (!decoded.has(key))
    decoded.set(
      key,
      (async () => {
        const bytes = Uint8Array.from(atob(sample.data.split(",")[1]!), (c) =>
          c.charCodeAt(0),
        );
        const buffer = await context.decodeAudioData(bytes.buffer),
          data = buffer.getChannelData(0);
        let peak = 0,
          onset = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value));
        while (
          onset < Math.min(data.length, buffer.sampleRate * 0.08) &&
          Math.abs(data[onset]!) < peak * 0.002
        )
          onset++;
        const crossing = (seconds: number) => {
          let i = Math.floor(seconds * buffer.sampleRate);
          const end = Math.min(data.length - 1, i + buffer.sampleRate * 0.04);
          while (i < end && !(data[i]! <= 0 && data[i + 1]! > 0)) i++;
          return i / buffer.sampleRate;
        };
        return {
          buffer,
          peak,
          offset: onset / buffer.sampleRate,
          loopStart: crossing(0.7),
          loopEnd: crossing(1.7),
        };
      })().catch((error) => {
        decoded.delete(key);
        throw error;
      }),
    );
  return {
    ...(await decoded.get(key))!,
    rate: 2 ** ((midi - sample.midi) / 12),
    sustain: preset.sustain,
  };
}
export function scheduleMusicSample(
  context: BaseAudioContext,
  destination: AudioNode,
  sample: Sample,
  when: number,
  duration: number,
  velocity: number,
) {
  const source = context.createBufferSource(),
    gain = context.createGain();
  source.buffer = sample.buffer;
  source.playbackRate.value = sample.rate;
  source.loop = sample.sustain;
  source.loopStart = sample.loopStart;
  source.loopEnd = sample.loopEnd;
  const end = when + Math.max(0.04, duration),
    level = velocity * Math.min(6, 0.22 / Math.max(0.025, sample.peak));
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(level, when + 0.004);
  gain.gain.setValueAtTime(level, Math.max(when + 0.005, end - 0.035));
  gain.gain.linearRampToValueAtTime(0, end);
  source.connect(gain).connect(destination);
  source.start(when, sample.offset);
  source.stop(end + 0.002);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
  return () => {
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(0, context.currentTime);
    try {
      source.stop();
    } catch {
      /* Already ended. */
    }
    source.disconnect();
    gain.disconnect();
  };
}
export type MusicPlayback = {
  beat: number;
  state: "paused" | "loading" | "playing" | "ended" | "error";
  error?: string;
};
/** One owned context per mounted player. Cancels decoding races, scheduled notes and RAF. */
export class MusicPlayer {
  private context?: AudioContext;
  private generation = 0;
  private stops: Array<() => void> = [];
  private frame = 0;
  private beat = 0;
  private disposed = false;
  constructor(private update: (state: MusicPlayback) => void) {}
  pause() {
    releaseMusicAudio(this);
    this.generation++;
    cancelAnimationFrame(this.frame);
    this.stops.splice(0).forEach((stop) => stop());
    if (!this.disposed) this.update({ beat: this.beat, state: "paused" });
    if (activePlayer === this) activePlayer = undefined;
  }
  private async ready() {
    if (this.disposed) throw Error("Player disposed");
    this.context ??= new AudioContext();
    await this.context.resume();
    if (this.context.state !== "running")
      throw Error("音频未能启动，请再次点击播放");
    return this.context;
  }
  async play(
    plan: MusicPlan,
    selection: MusicSelection,
    speed: number,
    fromBeat: number,
    loop: boolean,
  ) {
    this.pause();
    activePlayer?.pause();
    activePlayer = this;
    claimMusicAudio(this, () => this.pause());
    const generation = this.generation;
    const performance = musicPerformance(plan, selection, speed);
    this.beat =
      fromBeat >= performance.to
        ? performance.from
        : Math.max(performance.from, fromBeat);
    this.update({ beat: this.beat, state: "loading" });
    try {
      // Context is created/resumed directly from the click, before lazy sample loading.
      const context = await this.ready();
      const samples = await Promise.all(
        performance.notes.map((n) =>
          loadMusicSample(context, n.instrument, n.pitch.midi),
        ),
      );
      if (generation !== this.generation || this.disposed) return;
      const startBeat = this.beat,
        start = context.currentTime + 0.04;
      performance.notes.forEach((note, i) => {
        if (note.at + note.duration <= startBeat) return;
        const at = Math.max(startBeat, note.at),
          duration = note.at + note.duration - at;
        this.stops.push(
          scheduleMusicSample(
            context,
            context.destination,
            samples[i]!,
            start + (at - startBeat) * performance.secondsPerBeat,
            duration * performance.secondsPerBeat,
            note.velocity,
          ),
        );
      });
      const tick = () => {
        if (generation !== this.generation || this.disposed) return;
        this.beat = Math.min(
          performance.to,
          startBeat +
            Math.max(0, context.currentTime - start) /
              performance.secondsPerBeat,
        );
        if (this.beat >= performance.to) {
          this.pause();
          if (loop)
            void this.play(plan, selection, speed, performance.from, true);
          else this.update({ beat: this.beat, state: "ended" });
          return;
        }
        this.update({ beat: this.beat, state: "playing" });
        this.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.pause();
      this.update({
        beat: this.beat,
        state: "error",
        error: error instanceof Error ? error.message : "音频不可用",
      });
    }
  }
  async audition(midi: number, instrument: MusicInstrument) {
    this.pause();
    activePlayer?.pause();
    activePlayer = this;
    claimMusicAudio(this, () => this.pause());
    const generation = this.generation;
    try {
      const context = await this.ready(),
        sample = await loadMusicSample(context, instrument, midi);
      if (generation === this.generation && !this.disposed)
        this.stops.push(
          scheduleMusicSample(
            context,
            context.destination,
            sample,
            context.currentTime + 0.01,
            0.7,
            0.6,
          ),
        );
    } catch (error) {
      if (generation === this.generation && !this.disposed)
        this.update({ beat: this.beat, state: "error", error: String(error) });
    }
  }
  dispose() {
    this.disposed = true;
    this.pause();
    void this.context?.close();
    this.context = undefined;
  }
}
