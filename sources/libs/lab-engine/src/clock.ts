export type LabClockOptions = {
  fixedStepSeconds?: number;
  maxFrameDeltaSeconds?: number;
  maxStepsPerFrame?: number;
};

/**
 * A bounded fixed-step clock. Renderers may run at any frame rate while the
 * domain engine receives the same sequence of time steps for the same input.
 */
export class LabClock {
  readonly fixedStepSeconds: number;
  readonly maxFrameDeltaSeconds: number;
  readonly maxStepsPerFrame: number;

  private accumulatorSeconds = 0;
  private elapsedSeconds = 0;

  constructor(options: LabClockOptions = {}) {
    this.fixedStepSeconds = options.fixedStepSeconds ?? 1 / 60;
    this.maxFrameDeltaSeconds = options.maxFrameDeltaSeconds ?? 0.1;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 8;
    if (
      !Number.isFinite(this.fixedStepSeconds) ||
      this.fixedStepSeconds <= 0 ||
      !Number.isFinite(this.maxFrameDeltaSeconds) ||
      this.maxFrameDeltaSeconds <= 0 ||
      !Number.isInteger(this.maxStepsPerFrame) ||
      this.maxStepsPerFrame < 1
    ) {
      throw new Error("Invalid LabClock options");
    }
  }

  get elapsed() {
    return this.elapsedSeconds;
  }

  /** Advances by real time and invokes onStep for each bounded fixed step. */
  advance(realDeltaSeconds: number, onStep: (dt: number) => void): number {
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds <= 0) return 0;
    this.accumulatorSeconds += Math.min(
      realDeltaSeconds,
      this.maxFrameDeltaSeconds,
    );
    let steps = 0;
    while (
      this.accumulatorSeconds + 1e-7 >= this.fixedStepSeconds &&
      steps < this.maxStepsPerFrame
    ) {
      onStep(this.fixedStepSeconds);
      this.accumulatorSeconds -= this.fixedStepSeconds;
      this.elapsedSeconds += this.fixedStepSeconds;
      steps += 1;
    }
    if (steps === this.maxStepsPerFrame) {
      this.accumulatorSeconds = Math.min(
        this.accumulatorSeconds,
        this.fixedStepSeconds,
      );
    }
    return steps;
  }

  reset() {
    this.accumulatorSeconds = 0;
    this.elapsedSeconds = 0;
  }

  restore(elapsedSeconds: number) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
      throw new Error("Invalid LabClock elapsed time");
    }
    this.accumulatorSeconds = 0;
    this.elapsedSeconds = elapsedSeconds;
  }
}
