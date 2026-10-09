import React, {useContext, useLayoutEffect, useRef, useState} from "react";
import {MusicTimelineContext} from "./music-teaching-display.js";
import type {MusicPlaybackState} from "../../../libs/domain/src/index.js";
import {materialTeachingStepId, type MaterialTeaching} from "../../../libs/domain/src/index.js";
import {
  sampleMaterialTeaching, sampleMaterialTeachingTimeline,
  type MaterialTeachingSample, type MaterialTeachingCueInterval,
} from "../../../libs/domain/src/index.js";
import {TeachingArt} from "./teaching/teaching-art.js";
import "./teaching/teaching-display.css";

export type TeachingDisplayTimeline = {intervals: readonly MaterialTeachingCueInterval[]; tick: number};
/** Reading clicks have no audio clock. Animate only a newly addressed operation;
 * a repeated sentence holds, and film/classroom clocks never enter this hook. */
function useReadingOperationProgress(key: string, enabled: boolean) {
  const previous = useRef("");
  const [paint, setPaint] = useState({key, progress: 1});
  useLayoutEffect(() => {
    if (!enabled || !key) {previous.current = key; setPaint({key, progress: 1}); return;}
    if (previous.current === key) return;
    previous.current = key;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPaint({key, progress: 1});
      return;
    }
    let handle = 0;
    const start = performance.now();
    setPaint({key, progress: 0});
    const update = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - start) / 700));
      setPaint({key, progress});
      if (progress < 1) handle = requestAnimationFrame(update);
    };
    handle = requestAnimationFrame(update);
    return () => cancelAnimationFrame(handle);
  }, [key, enabled]);
  return paint.key === key ? paint.progress : 0;
}
/** Shared reading/classroom/film artwork; callers own narration and time. */
export function TeachingDisplay({block, activeTargetIds, previousActiveTargetIds, revealedTargetIds, progress, sample, teachingTimeline, timeline, music, reading = false, animate = false}: {
  block: MaterialTeaching;
  activeTargetIds?: readonly string[];
  previousActiveTargetIds?: readonly string[];
  revealedTargetIds?: readonly string[];
  progress?: number;
  sample?: MaterialTeachingSample;
  teachingTimeline?: TeachingDisplayTimeline;
  timeline?: TeachingDisplayTimeline;
  animate?: boolean;
  music?: MusicPlaybackState;
  reading?: boolean;
}) {
  const inheritedMusic = useContext(MusicTimelineContext);
  const clock = teachingTimeline ?? timeline;
  const activeStep = activeTargetIds?.flatMap(target => {const id = materialTeachingStepId(block, target); return id ? [id] : [];})[0];
  const animateReading = animate && !clock && !sample;
  const readingProgress = useReadingOperationProgress(activeStep ? `${block.id}:${activeStep}` : "", animateReading);
  const state = sample ?? (clock
    ? sampleMaterialTeachingTimeline(block, clock.intervals, clock.tick)
    : sampleMaterialTeaching(block, {activeTargetIds,
      previousActiveTargetIds: animateReading ? undefined : previousActiveTargetIds,
      revealedTargetIds, progress: animateReading && activeStep ? readingProgress * .72 : progress, reading}));
  return <section className="teaching-display" aria-label={block.title} data-teaching-display={block.templateId} data-teaching-step={state.stepId ?? ""} data-teaching-progress={state.progress} data-teaching-frame={state.frame}>
    <TeachingArt props={block} frame={state.frame} fps={state.fps} sample={state} music={music ?? inheritedMusic.music}
      motionSeconds={clock ? clock.tick / 48_000 : undefined}
      layerMotion={block.templateId === "general-layers" ? {focusId: state.stepId, layers: state.items} : undefined}/>
  </section>;
}
