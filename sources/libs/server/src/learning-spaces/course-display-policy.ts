import type { LearningSpaceItemRepository, LearningSpaceRepository } from "../../../domain/src/index.js";

type PolicyPersistence = {
  spaces: Pick<LearningSpaceRepository, "listByUserId">;
  items: Pick<LearningSpaceItemRepository, "findByGoalId">;
};

let persistence: PolicyPersistence | undefined;

export function configureCourseDisplayPolicyPersistence(value?: PolicyPersistence) {
  persistence = value;
}

/** Resolve actual membership for each generation, including existing goals and moved courses. */
export async function isGeneralEducationCourse(userId: string, goalId: string): Promise<boolean> {
  if (!persistence) throw new Error("Course display policy persistence unavailable");
  const item = await persistence.items.findByGoalId(userId, goalId);
  if (!item) return false;
  const spaces = await persistence.spaces.listByUserId(userId);
  const name = spaces.find((space) => space.id === item.spaceId)?.name.trim();
  return name === "通识课程" || name === "通识课程 · 四学期课程库";
}
