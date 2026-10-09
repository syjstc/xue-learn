import {
  materialTeachingStepId,
  materialTeachingSteps,
  type MaterialTeaching,
} from "./material-teaching.js";
import {materialTeachingFocusId, materialTeachingFocusTargets} from "./material-teaching-focus.js";

export type MaterialTeachingCueInterval = Readonly<{
  targetIds: readonly string[];
  startTick: number;
  durationTicks: number;
}>;
export type MaterialTeachingItemMotion = Readonly<{id: string; reveal: number; focus: number}>;
export type MaterialTeachingSample = Readonly<{
  stepId?: string;
  stepIndex: number;
  progress: number;
  grammarSeconds: number;
  frame: number;
  fps: 60;
  sourceItemIds: readonly string[];
  items: readonly MaterialTeachingItemMotion[];
  /** Local attention has its own clock; changing focus never repeats a transform. */
  focusTargets?: readonly Readonly<{id: string; focus: number; progress: number}>[];
}>;
const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** Each spoken operation owns one bounded visual transition. At its end the
 * completed state holds; the following operation requires its own cue. */
export function sampleMaterialTeaching(block: MaterialTeaching, input: {
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  revealedTargetIds?: readonly string[];
  /** Fraction through this actual spoken cue, independent of frame rate. */
  progress?: number;
  reading?: boolean;
} = {}): MaterialTeachingSample {
  const steps = materialTeachingSteps(block);
  const resolve = (targets: readonly string[] = []) => targets.flatMap(target => {
    const id = materialTeachingStepId(block, target); return id ? [id] : [];
  });
  const active = resolve(input.activeTargetIds), previous = resolve(input.previousActiveTargetIds);
  const seen = input.revealedTargetIds === undefined ? undefined : new Set(resolve(input.revealedTargetIds));
  let stepIndex = steps.findIndex(step => active.includes(step.id));
  if (stepIndex < 0 && seen?.size) steps.forEach((step, index) => {if (seen.has(step.id)) stepIndex = index;});
  if (stepIndex < 0 && input.reading) stepIndex = steps.length - 1;
  const step = steps[stepIndex];
  const repeated = step && active.includes(step.id) && previous.includes(step.id);
  const progress = step ? repeated || !active.length ? 1 : clamp((input.progress ?? 1) / .72) : 0;
  const grammarSeconds = step ? step.fromSeconds + (step.toSeconds - step.fromSeconds) * progress : 0;
  const focusIds = (targets: readonly string[] = []) => new Set(targets.flatMap(target => {
    const id = materialTeachingFocusId(block, target); return id ? [id] : [];
  }));
  const activeFocus = focusIds(input.activeTargetIds), previousFocus = focusIds(input.previousActiveTargetIds);
  const focusProgress = clamp(input.progress ?? 1);
  return {
    stepId: step?.id, stepIndex, progress, grammarSeconds, frame: grammarSeconds * 60, fps: 60,
    sourceItemIds: step?.sourceItemIds ?? [],
    items: steps.map((item, index) => ({
      id: item.id,
      reveal: index === stepIndex ? progress : input.reading && !active.length ? 1 : (seen ? seen.has(item.id) : index < stepIndex) ? 1 : 0,
      focus: active.includes(item.id) ? progress : 0,
    })),
    focusTargets: materialTeachingFocusTargets(block).filter(target => activeFocus.has(target.id) && !!step && target.operationIds.includes(step.id)).map(target => {
      const held = previousFocus.has(target.id);
      return {id: target.id, focus: held ? 1 : focusProgress, progress: held ? 1 : focusProgress};
    }),
  };
}

/** Reconstruct from accepted caption intervals on every seek. Repeating a cue
 * reuses the first operation interval and does not run the operation again. */
export function sampleMaterialTeachingTimeline(block: MaterialTeaching, intervals: readonly MaterialTeachingCueInterval[], tick: number): MaterialTeachingSample {
  const first = new Map<string, MaterialTeachingCueInterval>();
  let activeId: string | undefined;
  let overview = false;
  let currentTargets: readonly string[] = [], focusKey = '', focusStart = 0, focusDuration = 1;
  let previousFocus: readonly string[] = [];
  for (const interval of intervals) {
    if (interval.startTick > tick) continue;
    const focal = [...new Set(interval.targetIds.flatMap(target => {
      const id = materialTeachingFocusId(block, target); return id ? [id] : [];
    }))].sort();
    const id = interval.targetIds.flatMap(target => {
      const step = materialTeachingStepId(block, target); return step ? [step] : [];
    })[0];
    const nextFocusKey = `${id ?? ''}:${focal.join('|')}`;
    if (nextFocusKey !== focusKey) {
      previousFocus = currentTargets;
      focusStart = interval.startTick;
      focusDuration = Math.max(1, Math.min(21_600, interval.durationTicks * .32));
      focusKey = nextFocusKey;
    }
    currentTargets = interval.targetIds;
    if (!id) {overview = true; continue;}
    if (!first.has(id)) first.set(id, interval);
    activeId = id;
    overview = false;
  }
  const interval = activeId ? first.get(activeId) : undefined;
  const result = sampleMaterialTeaching(block, {
    activeTargetIds: activeId ? [activeId] : [],
    revealedTargetIds: [...first.keys()],
    progress: interval ? (tick - interval.startTick) / Math.max(1, interval.durationTicks) : 0,
  });
  const focusProgress = clamp((tick - focusStart) / focusDuration);
  const focus = sampleMaterialTeaching(block, {
    activeTargetIds: currentTargets, previousActiveTargetIds: previousFocus,
    progress: 1 - (1 - focusProgress) ** 3,
  }).focusTargets;
  return {...result, focusTargets: overview ? [] : focus,
    ...(overview ? {items: result.items.map(item => ({...item, focus: 0}))} : {})};
}
