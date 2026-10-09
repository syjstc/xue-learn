"use client";

import { teachingPersonaVisualAvatarCode } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { SCENARIO_AVATARS, SCENARIO_STANDINGS, COACH_STANDING_CODES } from "./scenario-theater-assets.ts";

/** Derive the avatar image path for a story character. */
export function scenarioAvatarSrc(
  avatar: keyof typeof SCENARIO_AVATARS | undefined,
  assetCode?: string,
): string {
  if (assetCode) return `/scenario-theater/cast/${assetCode}-avatar.png`;
  return `/teaching-personas/${SCENARIO_AVATARS[avatar ?? "mentor"]}.webp`;
}

/** Derive the full-body standing image path for a story character. */
export function scenarioStandingSrc(
  avatar: keyof typeof SCENARIO_STANDINGS | undefined,
  assetCode?: string,
): string {
  if (assetCode) return `/scenario-theater/cast/${assetCode}-standing.png`;
  return `/scenario-theater/${SCENARIO_STANDINGS[avatar ?? "mentor"]}-standing.png`;
}

/** Derive the coach avatar path from the avatar code. */
export function coachAvatarSrc(avatarCode?: string): string {
  const visual = teachingPersonaVisualAvatarCode(avatarCode ?? "xiaohui_female");
  return `/teaching-personas/${visual}.webp`;
}

/**
 * Full-body coach art is deliberately separate from the story cast.
 * Returns null when no standing art is available for the given code.
 */
export function coachStandingSrc(avatarCode?: string): string | null {
  const visual = avatarCode
    ? teachingPersonaVisualAvatarCode(avatarCode)
    : undefined;
  return visual && COACH_STANDING_CODES.has(visual)
    ? `/scenario-theater/coaches/${visual}-standing.png`
    : null;
}

export type ScenarioResultTransition = {
  key: string;
  sceneAct: number;
  selectedLabel: string;
  consequence: string;
  reflection: string;
  beforeMeters: Record<string, number>;
  afterMeters: Record<string, number>;
  effects: Array<{ meterId: string; delta: number }>;
  nextIsEnding: boolean;
};
