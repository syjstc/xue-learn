import { LabClock, type LabClockOptions } from "./clock.js";
import type {
  LabBudget,
  LabSample,
  LabRuntimeListener,
  LabSnapshot,
} from "./types.js";

export type LabRuntimeControllerOptions<TState> = LabClockOptions & {
  initialState: TState;
  step: (state: TState, dt: number) => TState;
  cloneState?: (state: TState) => TState;
  speed?: number;
  seed?: number;
  budget?: LabBudget;
  onParameter?: (state: TState, id: string, value: number | string | boolean) => TState;
};

/** Renderer-neutral lifecycle controller for a deterministic Lab domain. */
export class LabRuntimeController<TState> {
  readonly clock: LabClock;
  private readonly initialState: TState;
  private readonly stepState: LabRuntimeControllerOptions<TState>["step"];
  private readonly cloneState: (state: TState) => TState;
  private readonly onParameter?: LabRuntimeControllerOptions<TState>["onParameter"];
  private readonly budget: LabBudget;
  private readonly seed: number;
  private samples: LabSample<TState>[] = [];
  private speed: number;
  private state: TState;
  private running = false;
  private destroyed = false;
  private listeners = new Set<LabRuntimeListener<TState>>();

  constructor(options: LabRuntimeControllerOptions<TState>) {
    this.clock = new LabClock(options);
    this.cloneState = options.cloneState ?? ((value) => value);
    this.initialState = this.cloneState(options.initialState);
    this.state = this.cloneState(options.initialState);
    this.stepState = options.step;
    this.onParameter = options.onParameter;
    this.budget = options.budget ?? {};
    this.seed = Number.isFinite(options.seed) ? Math.trunc(options.seed as number) : 0;
    this.speed = Math.max(0.05, Math.min(8, options.speed ?? 1));
  }

  get currentState() {
    return this.state;
  }

  get isRunning() {
    return this.running;
  }

  get simulationSpeed() {
    return this.speed;
  }

  get sampleBuffer(): readonly LabSample<TState>[] {
    return this.samples;
  }

  setSpeed(speed: number) {
    this.assertAlive();
    this.speed = Math.max(0.05, Math.min(8, Number.isFinite(speed) ? speed : 1));
    this.emit();
  }

  setParameter(id: string, value: number | string | boolean) {
    this.assertAlive();
    if (!this.onParameter) return false;
    this.state = this.onParameter(this.state, id, value);
    this.emit();
    return true;
  }

  start() {
    this.assertAlive();
    this.running = true;
    this.emit();
  }

  pause() {
    this.assertAlive();
    this.running = false;
    this.emit();
  }

  reset() {
    this.assertAlive();
    this.running = false;
    this.clock.reset();
    this.state = this.cloneState(this.initialState);
    this.samples = [];
    this.emit();
  }

  /** Advances simulation time; render loops should call this once per frame. */
  advance(realDeltaSeconds: number) {
    this.assertAlive();
    if (!this.running) return 0;
    const steps = this.clock.advance(realDeltaSeconds * this.speed, (dt) => {
      this.state = this.stepState(this.state, dt);
    });
    if (steps > 0) {
      if (this.budget.maxRuntimeSeconds !== undefined && this.clock.elapsed >= this.budget.maxRuntimeSeconds) {
        this.running = false;
      }
      this.recordSample();
      this.emit();
    }
    return steps;
  }

  /** Performs one deterministic step even when paused, useful for tests. */
  stepOnce() {
    this.assertAlive();
    this.state = this.stepState(this.state, this.clock.fixedStepSeconds);
    this.clock.advance(this.clock.fixedStepSeconds, () => undefined);
    this.emit();
  }

  sample() {
    this.assertAlive();
    this.recordSample();
    return this.samples[this.samples.length - 1] ?? null;
  }

  snapshot(): LabSnapshot<TState> {
    this.assertAlive();
    return {
      version: 1,
      state: this.cloneState(this.state),
      elapsedSeconds: this.clock.elapsed,
      running: this.running,
      speed: this.speed,
      seed: this.seed,
      samples: this.samples.map((sample) => ({
        elapsedSeconds: sample.elapsedSeconds,
        state: this.cloneState(sample.state),
      })),
    };
  }

  restore(snapshot: LabSnapshot<TState>) {
    this.assertAlive();
    if (snapshot.version !== 1) throw new Error("Unsupported Lab snapshot version");
    this.clock.restore(snapshot.elapsedSeconds);
    this.state = this.cloneState(snapshot.state);
    this.running = snapshot.running;
    this.speed = Math.max(0.05, Math.min(8, snapshot.speed ?? 1));
    this.samples = (snapshot.samples ?? []).slice(-this.sampleLimit()).map((sample) => ({
      elapsedSeconds: sample.elapsedSeconds,
      state: this.cloneState(sample.state),
    }));
    this.emit();
  }

  subscribe(listener: LabRuntimeListener<TState>) {
    this.assertAlive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    this.running = false;
    this.destroyed = true;
    this.listeners.clear();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.state, this.clock.elapsed);
    }
  }

  private sampleLimit() {
    return Math.max(1, Math.min(this.budget.maxSamples ?? 240, 2_000));
  }

  private recordSample() {
    if (this.budget.maxSamples === 0) return;
    this.samples.push({ elapsedSeconds: this.clock.elapsed, state: this.cloneState(this.state) });
    if (this.samples.length > this.sampleLimit()) this.samples.splice(0, this.samples.length - this.sampleLimit());
  }

  private assertAlive() {
    if (this.destroyed) throw new Error("LabRuntimeController is destroyed");
  }
}
