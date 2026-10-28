import type { LearningPersistenceRuntime as ReferencePersistenceRuntime } from "../persistence/learning-repositories.js";
import {
  type LearningSpaceOrganizationPersistence,
  type LearningSpaceRepositories,
} from "./orm-application-service.js";

function organizationRepositories(
  repositories: ReferencePersistenceRuntime["repositories"],
): LearningSpaceRepositories {
  return {
    spaces: repositories.learningSpace,
    goals: repositories.learningGoal,
    items: repositories.learningSpaceItem,
    relations: repositories.learningSpaceItemRelation,
  };
}

/** Adapt the infrastructure reference runtime to the learning-space port set. */
export function createLearningSpaceOrganizationPersistence(
  runtime: ReferencePersistenceRuntime,
): LearningSpaceOrganizationPersistence {
  return {
    repositories: organizationRepositories(runtime.repositories),
    runInTransaction: (work) =>
      runtime.runInTransaction((repositories) =>
        work(organizationRepositories(repositories)),
      ),
  };
}
