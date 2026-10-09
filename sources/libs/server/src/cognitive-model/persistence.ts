import type {
  CognitiveModelExpansionContextRepository,
  CognitiveModelExpansionLeaseRepository,
  CognitiveModelGenerationRunRepository,
  CognitiveModelPublicationFinalizationRepository,
  CognitiveModelPublicationRepository,
  CognitiveModelPresentationReadRepository,
  LearnerStateMemoryInvalidationRepository,
  LearnerStateProjectionReadRepository,
  ProjectBlueprintRepository,
} from "../../../domain/src/index.js";

export type CognitiveModelPersistence = Readonly<{
  expansionContext: CognitiveModelExpansionContextRepository;
  expansionLease: CognitiveModelExpansionLeaseRepository;
  generationRun: CognitiveModelGenerationRunRepository;
  publication: CognitiveModelPublicationRepository;
  publicationFinalization: CognitiveModelPublicationFinalizationRepository;
  projectBlueprint: ProjectBlueprintRepository;
  learnerStateMemoryInvalidation: LearnerStateMemoryInvalidationRepository;
  presentationRead: CognitiveModelPresentationReadRepository;
  stateRead: LearnerStateProjectionReadRepository;
}>;

let configured: CognitiveModelPersistence | undefined;

export function configureCognitiveModelPersistence(
  persistence: CognitiveModelPersistence | undefined,
): void {
  configured = persistence;
}

export function cognitiveModelPersistence(): CognitiveModelPersistence | undefined {
  return configured;
}
