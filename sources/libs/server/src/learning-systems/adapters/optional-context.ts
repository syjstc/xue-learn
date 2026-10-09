import type { LearningSystemPersistenceClient } from "../persistence-client.js";
import { createAssessmentRuntimeCapability } from "../capabilities/assessment-runtime.js";
import { createScenarioTheaterCapability } from "../capabilities/scenario-theater.js";
export { OPTIONAL_CONTEXT_VIEW_KEYS } from "../capabilities/support/optional.js";

export function createOptionalContextCapabilities(
  options: { persistence: LearningSystemPersistenceClient },
) {
  const persistence = options.persistence;
  return [
    createAssessmentRuntimeCapability(persistence),
    createScenarioTheaterCapability(persistence),
  ];
}
