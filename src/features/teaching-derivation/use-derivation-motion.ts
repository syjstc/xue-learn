import { useLayoutEffect, useRef, useState } from "react";

export const DERIVATION_MOTION_MS = 640;

/** One cancellable clock per board. Export supplies its own tick-based progress. */
export function useDerivationMotion(ordinal: number, phase?: "before" | "after") {
  const previous = useRef(ordinal);
  const [motion, setMotion] = useState({
    from: ordinal,
    to: ordinal,
    progress: 1,
  });
  useLayoutEffect(() => {
    if (phase === "before") {
      previous.current = ordinal - 1;
      setMotion({ from: Math.max(0, ordinal - 1), to: ordinal, progress: 0 });
      return;
    }
    const from = previous.current;
    previous.current = ordinal;
    if (from === ordinal) return;
    if (
      Math.abs(from - ordinal) !== 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setMotion({ from: ordinal, to: ordinal, progress: 1 });
      return;
    }
    let frame = 0;
    let start: number | undefined;
    setMotion({ from, to: ordinal, progress: 0 });
    const advance = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / DERIVATION_MOTION_MS);
      setMotion({ from, to: ordinal, progress });
      if (progress < 1) frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [ordinal, phase]);
  return motion.to === ordinal
    ? motion
    : { from: ordinal, to: ordinal, progress: 1 };
}
