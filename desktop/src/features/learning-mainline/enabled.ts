import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
/** Independent rollout controls preserve old routes for a reversible pilot. */
export const MAINLINE_PHASES = {
  shell: true,
  persistence: true,
  recommendations: true,
  assessmentSkip: false,
} as const;
export function mainlineEnabled(phase: keyof typeof MAINLINE_PHASES = "shell") {
  return (
    isDesktopLocalRuntime() &&
    MAINLINE_PHASES.persistence &&
    MAINLINE_PHASES[phase]
  );
}
