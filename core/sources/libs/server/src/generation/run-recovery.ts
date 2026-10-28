import { safeJsonStringify } from "../../../common/src/index.js";
import type { AiGenerationRunRepository } from "../../../domain/src/index.js";
import { GENERATION_RUN_INTERRUPTED_CODE } from "./run-lease.js";

export const DEFAULT_GENERATION_INTERRUPTED_MESSAGE =
  "服务器已重启，本次生成已中断，请重试";

/**
 * A modular API process owns all request-scoped generation work. On startup,
 * every still-running row therefore belongs to the process that just exited.
 */
export async function recoverInterruptedGenerationRuns(
  repository: AiGenerationRunRepository,
  message = DEFAULT_GENERATION_INTERRUPTED_MESSAGE,
): Promise<{ runs: number; llmLogs: number }> {
  return repository.recoverInterrupted(
    message,
    safeJsonStringify({
      type: "error",
      message,
      code: GENERATION_RUN_INTERRUPTED_CODE,
    }),
  );
}
