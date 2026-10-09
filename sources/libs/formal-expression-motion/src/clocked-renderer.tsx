import { MAX_MOTION_EM } from "./fit.js";
import { FormalMotionRenderer, type FormalMotionRendererProps } from "./renderer.js";

/** Classroom host: interpolation is a pure function of `progress`. Fit to the
 * board, but never exceed `MAX_MOTION_EM`. Default alignment is center; highlight
 * is glyph ink, not a background wash. */
export function FormalMotionClockedRenderer(
  props: FormalMotionRendererProps & { progress: number },
) {
  return (
    <FormalMotionRenderer
      {...props}
      align={props.align ?? "center"}
      emphasisMode={props.emphasisMode ?? "ink"}
      fit={props.fit ?? true}
      maxEm={props.maxEm ?? MAX_MOTION_EM}
      className={["fer-motion-clocked", props.className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
