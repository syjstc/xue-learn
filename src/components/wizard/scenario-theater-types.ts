import type { ScenarioTheaterStoryBeat } from "@/shared/domain/scenario-theater";

/** Internal type for tracking the post-choice transition overlay state. */
export type StoryTransition = {
  key: string;
  consequence: string;
  reflection?: string;
  effects: Array<{ meterId: string; delta: number }>;
  nextIsEnding: boolean;
};
