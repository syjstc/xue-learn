import type { CognitiveModelGenerationRunRepository } from "../../../domain/src/index.js";

/** Nest token for the owner-scoped unit cognitive-generation run lifecycle. */
export const COGNITIVE_MODEL_GENERATION_RUN_REPOSITORY = Symbol(
  "COGNITIVE_MODEL_GENERATION_RUN_REPOSITORY",
);

export type CognitiveModelGenerationRunPort =
  CognitiveModelGenerationRunRepository;
