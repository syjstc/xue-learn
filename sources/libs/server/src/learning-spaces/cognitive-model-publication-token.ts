import type { CognitiveModelPublicationRepository } from "../../../domain/src/index.js";

export const COGNITIVE_MODEL_PUBLICATION_REPOSITORY = Symbol(
  "COGNITIVE_MODEL_PUBLICATION_REPOSITORY",
);

export type CognitiveModelPublicationPort = CognitiveModelPublicationRepository;
