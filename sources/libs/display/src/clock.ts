import type {DisplayClock, DisplayTimelineCue} from "./types.js";

/** Frame sampling is deterministic, including backwards seeks and fractional frames. */
export function createDisplayClock(frame: number, fps = 30, options: {ticksPerSecond?: number; playing?: boolean} = {}): DisplayClock {
  const ticksPerSecond = options.ticksPerSecond ?? 48_000;
  if (!Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0 || !Number.isSafeInteger(ticksPerSecond) || ticksPerSecond <= 0) throw new Error("Invalid display clock");
  const timeSeconds = Math.max(0, frame) / fps;
  return Object.freeze({frame: Math.max(0, frame), fps, timeSeconds, tick: Math.round(timeSeconds * ticksPerSecond), ticksPerSecond, playing: options.playing ?? false});
}

export function displayClockAtTick(tick: number, fps = 30, ticksPerSecond = 48_000, playing = false): DisplayClock {
  if (!Number.isFinite(tick)) throw new Error("Invalid display tick");
  return createDisplayClock(Math.max(0, tick) / ticksPerSecond * fps, fps, {ticksPerSecond, playing});
}

export function activeDisplayTargets(cues: readonly DisplayTimelineCue[] = [], clock: DisplayClock): readonly string[] {
  return [...new Set(cues.filter(cue => clock.tick >= cue.startTick && clock.tick < cue.startTick + cue.durationTicks).flatMap(cue => cue.targets))];
}
