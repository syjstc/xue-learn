export class GenerationCancelledError extends Error {
  constructor(message = "生成已停止") {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

export function isGenerationCancelled(e: unknown): boolean {
  return e instanceof GenerationCancelledError;
}
