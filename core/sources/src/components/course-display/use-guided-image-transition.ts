import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  guidedImageStillFrame,
  guidedImageTransitionFrame,
  type GuidedImageRegion,
} from "../../../libs/domain/src/index.js";

const DURATION_MS = 260;
/** Classroom playback/export samples a timeline tick. Reading clicks animate
 * from the last visible selection, including interrupted transitions. */
export const GuidedImageTimelineContext = createContext(false);

export function useGuidedImageTransition(
  identity: string,
  regions: readonly GuidedImageRegion[],
  previous: readonly GuidedImageRegion[],
  clocked: boolean,
  progress: number,
) {
  const useTimeline = useContext(GuidedImageTimelineContext) && clocked;
  const [reduced, setReduced] = useState(false);
  const [frame, setFrame] = useState(() => guidedImageStillFrame(regions));
  const painted = useRef(frame);
  const source = useRef(identity);
  const target = useRef(regions);
  target.current = regions;
  const key = regions.map((region) => region.id).join("|");
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (useTimeline) return;
    if (source.current !== identity || reduced) {
      source.current = identity;
      painted.current = guidedImageStillFrame(target.current);
      setFrame(painted.current);
      return;
    }
    // Start at the currently painted geometry, including during rapid clicks.
    const from = painted.current;
    const to = target.current;
    const started = performance.now();
    let request = 0;
    const tick = (now: number) => {
      const ratio = Math.min(1, (now - started) / DURATION_MS);
      painted.current = guidedImageTransitionFrame(from, to, ratio);
      setFrame(painted.current);
      if (ratio < 1) request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [identity, key, useTimeline, reduced]);
  if (useTimeline)
    return guidedImageTransitionFrame(
      guidedImageStillFrame(previous),
      regions,
      reduced ? 1 : progress,
    );
  if (source.current !== identity || reduced)
    return guidedImageStillFrame(regions);
  return frame;
}
