import { useEffect, useRef, useState } from "react";
import {
  guidedImageCamera,
  type GuidedImageAsset,
  type GuidedImageRegion,
} from "../../../libs/domain/src/index.js";

export function useGuidedImageCamera(
  identity: string,
  image: GuidedImageAsset,
  regions: readonly GuidedImageRegion[],
  enabled: boolean,
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [overviewFor, setOverviewFor] = useState<string>();
  const overview = overviewFor === identity;
  const full = guidedImageCamera({ image, viewport: size, regions: [] });
  const [camera, setCamera] = useState(full);
  const painted = useRef(camera);
  const lastIdentity = useRef(identity);
  const destination = useRef(full);
  const currentRegions = useRef(regions);
  currentRegions.current = regions;
  const key = regions
    .map((region) => region.id)
    .sort()
    .join("|");
  const candidate = guidedImageCamera({
    image,
    viewport: size,
    regions: enabled ? regions : [],
  });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let request = 0;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      cancelAnimationFrame(request);
      const fresh = lastIdentity.current !== identity;
      lastIdentity.current = identity;
      const next = guidedImageCamera({
        image,
        viewport: size,
        regions: enabled && !overview ? currentRegions.current : [],
        previous: fresh ? undefined : destination.current,
      });
      destination.current = next;
      if (!enabled || fresh || media.matches || size.width === 0) {
        painted.current = next;
        setCamera(next);
        return;
      }
      // Brief dwell discards transient targets during quick replay/seek clicks.
      timer = setTimeout(
        () => {
          const from = painted.current;
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / 480);
            const t = 1 - (1 - progress) ** 3;
            const mix = (a: number, b: number) => a + (b - a) * t;
            painted.current = {
              x: mix(from.x, next.x),
              y: mix(from.y, next.y),
              width: mix(from.width, next.width),
              height: mix(from.height, next.height),
              zoom: mix(from.zoom, next.zoom),
            };
            setCamera(painted.current);
            if (progress < 1) request = requestAnimationFrame(tick);
          };
          request = requestAnimationFrame(tick);
        },
        overview ? 0 : 140,
      );
    };
    update();
    media.addEventListener("change", update);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(request);
      media.removeEventListener("change", update);
    };
  }, [
    identity,
    key,
    enabled,
    overview,
    size.width,
    size.height,
    image.width,
    image.height,
  ]);

  return {
    viewportRef,
    viewport: size,
    camera: lastIdentity.current === identity ? camera : full,
    overview,
    canFocus: candidate.zoom > 1,
    toggleOverview: () => setOverviewFor(overview ? undefined : identity),
  };
}
