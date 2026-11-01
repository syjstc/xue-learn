import { translateCurrent } from "@xue-learn/core/i18n";

export class GenerationCancelledError extends Error {
  constructor(message = translateCurrent("trajectory.cancelled")) {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

export function isGenerationCancelled(e: unknown): boolean {
  return e instanceof GenerationCancelledError;
}
