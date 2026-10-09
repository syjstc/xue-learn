import type { ReactElement } from "react";
import type { LearnerRouteId } from "@/shared/routes/learner-route-descriptors";

export const desktopLocalOwnedRouteIds = [
  "root",
  "onboarding",
  "today",
  "review-session",
] as const satisfies readonly LearnerRouteId[];

const desktopLocalOwnedRouteIdSet = new Set<LearnerRouteId>(
  desktopLocalOwnedRouteIds,
);

/** Prevent transitional desktop composition from silently replacing shared pages. */
export function defineDesktopRouteOverrides<
  T extends Partial<Record<LearnerRouteId, ReactElement>>,
>(elements: T): T {
  for (const routeId of Object.keys(elements) as LearnerRouteId[]) {
    if (!desktopLocalOwnedRouteIdSet.has(routeId)) {
      throw new Error(
        `Desktop-local cannot override shared learner route: ${routeId}`,
      );
    }
  }
  return elements;
}
