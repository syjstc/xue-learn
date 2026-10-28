import { tBackend } from "../../../common/src/index.js";

export class GenerationCancelledError extends Error {
  constructor(message = tBackend("error.generation.cancelled")) {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

export function isGenerationCancelled(e: unknown): boolean {
  return e instanceof GenerationCancelledError;
}
