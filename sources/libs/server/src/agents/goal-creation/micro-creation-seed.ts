import type { ThreadCheckpoint } from "../core/checkpoint.js";
import { goalStateFromCheckpoint } from "./state.js";

export type MicroCreationSeed = {
  isSmallCourse: boolean;
  topic?: string;
};

export function isMicroFastPathReady(
  state: ReturnType<typeof goalStateFromCheckpoint>,
): boolean {
  return (
    state.isSmallCourse === true &&
    !state.goalId &&
    state.collectedFields.includes("isSmallCourse")
  );
}

export function isGoalTopicTooVague(topic: string): boolean {
  const trimmed = topic.trim();
  if (!trimmed) return true;
  if (trimmed.length < 5) return true;
  return /^(学点东西|随便学学|学习)$/.test(trimmed);
}

export function applyMicroCreationSeed(
  checkpoint: ThreadCheckpoint,
  seed: MicroCreationSeed,
): ThreadCheckpoint {
  if (!seed.isSmallCourse) {
    return checkpoint;
  }

  const state = goalStateFromCheckpoint(checkpoint);
  const topic = seed.topic?.trim() || state.topic;
  const collectedFields = Array.from(
    new Set([...state.collectedFields, "isSmallCourse"]),
  );

  return {
    ...checkpoint,
    goalState: {
      ...state,
      topic,
      isSmallCourse: true,
      level: "zero",
      collectedFields,
    },
  };
}
