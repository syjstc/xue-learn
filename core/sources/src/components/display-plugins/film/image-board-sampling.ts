import type {CompiledVideoTimelineV1} from './timeline.js';
import {guidedImageHighlightRegions, guidedImageStillFrame, guidedImageTransitionFrame,
  type GuidedImageHighlightFrame, type GuidedImageRegion} from "../../../../libs/domain/src/guided-image.js";
import {guidedImageCamera, guidedImageCameraFrame, type GuidedImageCamera} from "../../../../libs/domain/src/guided-image-camera.js";
import type {MaterialTeachingCueInterval} from "../../../../libs/domain/src/material-teaching-motion.js";
import type {RemotionImageComponent, RemotionLessonSceneV1} from "./types.js";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const sameTargets = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));
// A tall, narrow comparison column at an image edge often sits beside the
// objects and connecting lines being compared. Zooming solely to that column
// crops the source objects. Preserve the overview and the exact highlights.
function cameraRegions(regions: readonly GuidedImageRegion[]): readonly GuidedImageRegion[] {
  if (regions.length < 2) return regions;
  const points = regions.flatMap(region => region.polygons.flatMap(polygon => polygon.outer));
  if (!points.length) return regions;
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const width = right - left, height = Math.max(...ys) - Math.min(...ys);
  return width < .2 && height > .45 && (left > .7 || right < .3) ? [] : regions;
}
// Fixed native board minus its stable padding and caption lane; outer preview
// scaling never changes the source camera or moves text between narration cues.
export const IMAGE_BOARD_VIEWPORT = {width: 1476.8, height: 635.6};

/** Rebuild from accepted narration ticks, including overlapping moves and reverse seek.
 * Repeating a subject continues its movement instead of restarting the camera. */
export function sampleImageBoard(scene: RemotionLessonSceneV1, timeline: CompiledVideoTimelineV1, tick: number,
  viewport = IMAGE_BOARD_VIEWPORT) {
  const props = scene.component.props as RemotionImageComponent['props'] & {
    activeTargetIds?: readonly string[];
    previousActiveTargetIds?: readonly string[];
    progress?: number;
    teachingTimeline?: {intervals: readonly MaterialTeachingCueInterval[]; tick: number};
  };
  if (scene.component.type !== 'image.v1' || !props.guidedImage) return undefined;
  const image = props.guidedImage;
  const regions = guidedImageHighlightRegions(image.segmentation, image);
  const localTargets = (ids: readonly string[]) => regions.filter(region => ids.includes(region.id) || ids.includes(`image:${region.id}`)).map(region => region.id);
  // Accepted course pictures carry their original image:region cues, whereas
  // film presentation beats may only identify a source_cue_N speech fragment.
  // Reconstruct from the complete source intervals before consulting film beats.
  const source = props.teachingTimeline;
  if (!source && props.activeTargetIds !== undefined) {
    const targets = localTargets(props.activeTargetIds);
    const selected = regions.filter(region => targets.includes(region.id));
    const previousTargets = localTargets(props.previousActiveTargetIds ?? []);
    const previous = regions.filter(region => previousTargets.includes(region.id));
    const progress = clamp(props.progress ?? 1);
    return {image, targets, labels: selected.map(region => region.label),
      camera: guidedImageCameraFrame({image, viewport, regions: cameraRegions(selected), previousRegions: cameraRegions(previous), progress}),
      frame: guidedImageTransitionFrame(guidedImageStillFrame(previous), selected, progress)};
  }
  const intervals = source ? source.intervals : scene.beats.flatMap(beat => {
    const track = timeline.tracks.find(track => track.kind === 'caption' && track.beatId === beat.id);
    return track ? [{...track, targetIds: beat.action === 'overview' ? [] : beat.targetIds}] : [];
  });
  const atTick = source?.tick ?? tick;
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
  for (const track of intervals) {
    if (track.startTick > atTick) continue;
    const next = localTargets(track.targetIds);
    if (sameTargets(next, targets)) continue;
    const current = sample(track.startTick);
    fromFrame = current.frame;
    fromCamera = current.camera;
    targets = next;
    selected = regions.filter(region => targets.includes(region.id));
    toCamera = guidedImageCamera({image, viewport, regions: cameraRegions(selected), previous: fromCamera, readabilityScale: 1.5});
    start = track.startTick;
    // A short narration still reaches its subject; long narration holds it steady.
    duration = Math.max(1, Math.min(43_200, Math.round(track.durationTicks * .65)));
  }
  const sampled = sample(atTick);
  return {...sampled, targets, labels: selected.map(region => region.label), image};
}
