import { translateCurrent } from "../i18n/index.js";
import {
  renderMusicPcm,
  type MusicPerformancePlan as TimelineMusicInput,
  type MusicPcmSample,
} from "../../../libs/domain/src/index.js";
import { claimMusicAudio, releaseMusicAudio } from "./audio-ownership.js";

let catalog:
  | Promise<
      Array<{
        id: string;
        sustain: boolean;
        samples: Array<{ midi: number; data: string }>;
      }>
    >
  | undefined;
const samples = new Map<string, Promise<MusicPcmSample>>();
export async function renderMusicBuffer(
  context: BaseAudioContext,
  plan: TimelineMusicInput,
) {
  const presets = await (catalog ??= import("./assets/instruments.json")
    .then((m) => m.default)
    .catch((error) => {
      catalog = undefined;
      throw error;
    }));
  const pcm = await renderMusicPcm(plan, async (instrument, midi) => {
    const preset = presets.find((p) => p.id === instrument);
    if (!preset) throw Error(`Unknown instrument ${instrument}`);
    const sample = preset.samples.reduce((a, b) =>
      Math.abs(b.midi - midi) < Math.abs(a.midi - midi) ? b : a,
    );
    const key = `${instrument}:${sample.midi}:${context.sampleRate}`;
    if (!samples.has(key))
      samples.set(
        key,
        (async () => {
          const bytes = Uint8Array.from(atob(sample.data.split(",")[1]!), (c) =>
            c.charCodeAt(0),
          );
          const buffer = await context.decodeAudioData(bytes.buffer);
          return {
            data: buffer.getChannelData(0),
            sampleRate: buffer.sampleRate,
            midi: sample.midi,
            sustain: preset.sustain,
          };
        })().catch((error) => {
          samples.delete(key);
          throw error;
        }),
      );
    return samples.get(key)!;
  });
  const buffer = context.createBuffer(1, pcm.length, 48_000);
  buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  return buffer;
}

let active: MusicClipPlayer | undefined;
export class MusicClipPlayer {
  private context?: AudioContext;
  private generation = 0;
  private source?: AudioBufferSourceNode;
  private raf = 0;
  private notify?: (tick: number | null) => void;
  private disposed = false;
  private prepared?: { plan: TimelineMusicInput; buffer: Promise<AudioBuffer> };
  async prepare(plan: TimelineMusicInput) {
    if (this.disposed) throw Error("Music player disposed");
    this.context ??= new AudioContext({ sampleRate: 48_000 });
    await this.context.resume();
    if (this.context.state !== "running")
      throw Error(
        translateCurrent("display.ui.audioCouldNotStartPressListenToTryAgain"),
      );
    if (this.prepared?.plan !== plan)
      this.prepared = {
        plan,
        buffer: renderMusicBuffer(this.context, plan).catch((error) => {
          this.prepared = undefined;
          throw error;
        }),
      };
    return this.prepared.buffer;
  }
  stop() {
    releaseMusicAudio(this);
    this.generation++;
    cancelAnimationFrame(this.raf);
    if (this.source) {
      try {
        this.source.stop();
      } catch {}
      this.source.disconnect();
      this.source = undefined;
    }
    this.notify?.(null);
    this.notify = undefined;
    if (active === this) active = undefined;
  }
  async play(
    plan: TimelineMusicInput,
    offset: number,
    notify: (tick: number | null) => void,
  ) {
    if (this.disposed) return;
    this.stop();
    active?.stop();
    active = this;
    claimMusicAudio(this, () => this.stop());
    this.notify = notify;
    const generation = this.generation;
    const buffer = await this.prepare(plan);
    if (generation !== this.generation || this.disposed) return;
    const source = this.context!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context!.destination);
    this.source = source;
    const start = this.context!.currentTime;
    source.start(start, offset / 48_000);
    const tick = () => {
      if (generation !== this.generation || this.disposed) return;
      const position =
        offset + Math.round((this.context!.currentTime - start) * 48_000);
      if (position >= plan.durationTicks) {
        this.stop();
        return;
      }
      notify(position);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  dispose() {
    this.disposed = true;
    this.stop();
    void this.context?.close();
    this.context = undefined;
  }
}
