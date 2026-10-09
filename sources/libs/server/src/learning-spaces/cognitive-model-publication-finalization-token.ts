import type { CognitiveModelPublicationFinalizationRepository } from "../../../domain/src/index.js";

export const COGNITIVE_MODEL_PUBLICATION_FINALIZATION_REPOSITORY = Symbol(
  "COGNITIVE_MODEL_PUBLICATION_FINALIZATION_REPOSITORY",
);

export type CognitiveModelPublicationFinalizationPort =
  CognitiveModelPublicationFinalizationRepository;
