import type { LearningMainlineRepository } from "../../../domain/src/index.js";
let repository: LearningMainlineRepository | undefined;
export function configureLearningMainlinePersistence(
  value?: LearningMainlineRepository,
) {
  repository = value;
}
export function learningMainlinePersistence() {
  if (!repository) throw new Error("Learning mainline unavailable");
  return repository;
}
export function learningMainlineEnabled() {
  return (
    process.env.XUELEARN_DESKTOP_LOCAL === "1" &&
    process.env.XUELEARN_MAINLINE !== "0" &&
    Boolean(repository)
  );
}
