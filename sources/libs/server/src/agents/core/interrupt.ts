import type { AgentInterrupt } from "./types.js";
import type { ThreadCheckpoint } from "./checkpoint.js";

export function setInterrupt(
  checkpoint: ThreadCheckpoint,
  interrupt: AgentInterrupt,
): ThreadCheckpoint {
  return {
    ...checkpoint,
    pendingInterrupt: interrupt,
  };
}

export function clearInterrupt(
  checkpoint: ThreadCheckpoint,
): ThreadCheckpoint {
  return {
    ...checkpoint,
    pendingInterrupt: null,
  };
}

export function getPendingInterrupt(
  checkpoint: ThreadCheckpoint,
): AgentInterrupt | null {
  return checkpoint.pendingInterrupt ?? null;
}
