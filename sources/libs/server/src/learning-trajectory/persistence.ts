import type { LearningTrajectoryRepository } from "../../../domain/src/index.js";
let configured: LearningTrajectoryRepository | undefined;
export function configureLearningTrajectoryPersistence(
  repository?: LearningTrajectoryRepository,
) {
  configured = repository;
}
export function learningTrajectoryPersistence(): LearningTrajectoryRepository {
  if (!configured)
    throw new Error("Learning trajectory persistence unavailable");
  return configured;
}
export function learningTrajectoryEnabled() {
  return process.env.XUELEARN_DESKTOP_LOCAL === "1" && Boolean(configured);
}
