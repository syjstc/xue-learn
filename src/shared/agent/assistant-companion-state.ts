export type AssistantCompanionMode = "collapsed" | "docked" | "focus";

export const ASSISTANT_SURFACE_STORAGE_KEY = "xue-learn:assistant-surface:v1";
export const ASSISTANT_DOCK_MIN_WIDTH = 360;
export const ASSISTANT_DOCK_MAX_WIDTH = 520;
export const ASSISTANT_DOCK_DEFAULT_WIDTH = 400;
export const COMPANION_COLLAPSED_RAIL_WIDTH = 44;
export const IMMERSIVE_FOLLOW_UP_DEFAULT_WIDTH = 440;
export const ASSISTANT_VIEWPORT_MARGIN = 16;
export const ASSISTANT_COMPACT_BREAKPOINT = 768;
/** Immersive learning: side-dock companion only at this width+; narrower uses full-screen cover. */
export const IMMERSIVE_ASSISTANT_DOCK_BREAKPOINT = 1024;

export type AssistantSurfacePreference = {
  dockWidth: number;
  immersiveFollowUpWidth: number;
};

export const DEFAULT_ASSISTANT_SURFACE_PREFERENCE: AssistantSurfacePreference =
  {
    dockWidth: ASSISTANT_DOCK_DEFAULT_WIDTH,
    immersiveFollowUpWidth: IMMERSIVE_FOLLOW_UP_DEFAULT_WIDTH,
  };

export function clampDockWidth(
  width: number,
  viewportWidth: number,
): number {
  const available = Math.max(
    ASSISTANT_DOCK_MIN_WIDTH,
    viewportWidth - ASSISTANT_VIEWPORT_MARGIN * 2,
  );
  return Math.min(
    Math.max(width, ASSISTANT_DOCK_MIN_WIDTH),
    Math.min(ASSISTANT_DOCK_MAX_WIDTH, available),
  );
}

export function readAssistantSurfacePreference(
  value: string | null,
): AssistantSurfacePreference {
  if (!value) return DEFAULT_ASSISTANT_SURFACE_PREFERENCE;
  try {
    const parsed = JSON.parse(value) as Partial<AssistantSurfacePreference>;
    return {
      dockWidth:
        typeof parsed.dockWidth === "number" &&
        Number.isFinite(parsed.dockWidth)
          ? clampDockWidth(parsed.dockWidth, Number.POSITIVE_INFINITY)
          : ASSISTANT_DOCK_DEFAULT_WIDTH,
      immersiveFollowUpWidth:
        typeof parsed.immersiveFollowUpWidth === "number" &&
        Number.isFinite(parsed.immersiveFollowUpWidth)
          ? clampDockWidth(
              parsed.immersiveFollowUpWidth,
              Number.POSITIVE_INFINITY,
            )
          : IMMERSIVE_FOLLOW_UP_DEFAULT_WIDTH,
    };
  } catch {
    return DEFAULT_ASSISTANT_SURFACE_PREFERENCE;
  }
}
