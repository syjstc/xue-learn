import type {CompiledVideoTimelineV1} from './timeline.js';
import {guidedImageHighlightRegions, guidedImageStillFrame, guidedImageTransitionFrame,
  type GuidedImageHighlightFrame, type GuidedImageRegion} from "../../../../libs/domain/src/guided-image.js";
import {guidedImageCamera, type GuidedImageCamera} from "../../../../libs/domain/src/guided-image-camera.js";
import type {RemotionImageComponent, RemotionLessonSceneV1} from "./types.js";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const sameTargets = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));
// Fixed native board minus its stable padding and caption lane; outer preview
// scaling never changes the source camera or moves text between narration cues.
export const IMAGE_BOARD_VIEWPORT = {width: 1476.8, height: 635.6};

/** Rebuild from accepted narration ticks, including overlapping moves and reverse seek.
 * Repeating a subject continues its movement instead of restarting the camera. */
export function sampleImageBoard(scene: RemotionLessonSceneV1, timeline: CompiledVideoTimelineV1, tick: number,
  viewport = IMAGE_BOARD_VIEWPORT) {
  const props = scene.component.props as RemotionImageComponent['props'];
  if (scene.component.type !== 'image.v1' || !props.guidedImage) return undefined;
  const image = props.guidedImage;
  const regions = guidedImageHighlightRegions(image.segmentation, image);
  const whole = guidedImageCamera({image, viewport, regions: []});
  let fromFrame: GuidedImageHighlightFrame = guidedImageStillFrame([]);
  let fromCamera = whole;
  let toCamera = whole;
  let targets: readonly string[] = [];
  let selected: readonly GuidedImageRegion[] = [];
  let start = 0;
  let duration = 1;
  const sample = (at: number) => {
    const progress = clamp((at - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    const mix = (a: number, b: number) => a + (b - a) * eased;
    const camera: GuidedImageCamera = {x: mix(fromCamera.x, toCamera.x), y: mix(fromCamera.y, toCamera.y),
      width: mix(fromCamera.width, toCamera.width), height: mix(fromCamera.height, toCamera.height), zoom: mix(fromCamera.zoom, toCamera.zoom)};
    return {camera, frame: guidedImageTransitionFrame(fromFrame, selected, progress)};
  };
  for (const beat of scene.beats) {
    const track = timeline.tracks.find(track => track.kind === 'caption' && track.beatId === beat.id);
    if (!track || track.startTick > tick) continue;
    const next = beat.action === 'overview' ? [] : beat.targetIds;
    if (sameTargets(next, targets)) continue;
    const current = sample(track.startTick);
    fromFrame = current.frame;
    fromCamera = current.camera;
    targets = next;
    selected = regions.filter(region => targets.includes(region.id));
    toCamera = guidedImageCamera({image, viewport, regions: selected, previous: fromCamera, readabilityScale: 1.5});
    start = track.startTick;
    // A short narration still reaches its subject; long narration holds it steady.
    duration = Math.max(1, Math.min(43_200, Math.round(track.durationTicks * .65)));
  }
  const sampled = sample(tick);
  return {...sampled, targets, labels: selected.map(region => region.label), image};
}
