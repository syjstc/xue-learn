import type {DisplayNode, DisplayTimelineCue} from '../../../libs/display/src/types.js';

function containsTarget(node: DisplayNode, targets: readonly string[]): boolean {
  return targets.some(target => target === node.id || target.startsWith(node.id + '/'))
    || [...(node.children ?? []), ...Object.values(node.slots ?? {}).flat()].some(child => containsTarget(child, targets));
}

/** Individually narrated columns and grids use the whole video viewport for the current page.
 * Only paginate when every child is covered, so untargeted context is never lost. */
export function compositionPages(node: DisplayNode, timeline: readonly DisplayTimelineCue[], tick: number, mode: 'video' | 'interactive'): readonly number[] | undefined {
  const children = node.children ?? [];
  if (mode !== 'video' || !['column','grid'].includes((node.payload as {layout?: string}).layout ?? '') || children.length < 2 || Object.values(node.slots ?? {}).some(slot => slot.length)) return;
  const cues = timeline.map(cue => ({...cue, pages: children.flatMap((child, index) => containsTarget(child, cue.targets) ? [index] : [])}))
    .filter(cue => cue.pages.length).sort((a, b) => a.startTick - b.startTick);
  if (children.some((_, index) => !cues.some(cue => cue.pages.includes(index)))) return;
  const overview = timeline.filter(cue => cue.targets.includes(node.id)).map(cue => ({...cue, pages: children.map((_, index) => index)}));
  return ([...cues,...overview].filter(cue => cue.startTick <= tick).sort((a, b) => a.startTick - b.startTick).at(-1) ?? cues[0])?.pages;
}
