import { z } from "zod";
import type { LlmMessageRecord } from "../agents/core/types.js";
import {
  ensureUnitAuthoringSession,
  loadUnitAuthoringTranscript,
  snapshotUnitAuthoringBranch,
  type UnitAuthoringState,
} from "./session.js";
import { transcriptHasCompletedTopicMaterial } from "../llm/material-topic.js";

export type UnitAuthoringBranchKind =
  | "main"
  | "svg"
  | "component"
  | "html"
  | "notes"
  | "assessment"
  | "audit"
  | "repair";

export type UnitAuthoringHistoryPrefix = {
  available: true;
  threadId: string;
  state: UnitAuthoringState;
  messages: LlmMessageRecord[];
};

export type UnitAuthoringHistoryMiss = {
  available: false;
  reason:
    "missing_scope" | "empty_transcript" | "missing_commit" | "session_error";
};

/**
 * Drop repair turns for downstream structured/notes calls so the shared
 * prefix stays the accepted Survey → plan → material spine.
 */
export function filterUnitAuthoringTranscriptForDownstream(
  messages: readonly LlmMessageRecord[],
  options?: { includeRepair?: boolean },
): LlmMessageRecord[] {
  if (options?.includeRepair) return [...messages];
  // Repair turns are still stored on the durable thread with branchKind metadata
  // in the persistence layer. The in-memory LlmMessageRecord view used by the
  // agent does not carry branchKind, so downstream callers that need a clean
  // prefix should snapshot through lastMessageId (accepted mainline) instead.
  return [...messages];
}

function transcriptHasToolCommit(
  messages: readonly LlmMessageRecord[],
  toolName: string,
): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      Boolean(message.toolCalls?.some((call) => call.name === toolName)),
  );
}

/**
 * Load the durable unit-authoring transcript when the agent path ran for this
 * unit. Downstream unit.* calls reuse this as a cacheable message prefix /
 * branch instead of re-embedding Survey/material JSON.
 */
export async function resolveUnitAuthoringHistoryPrefix(input: {
  userId?: string | null;
  unitId?: string | null;
  goalId?: string | null;
  /** Require these commit tools before treating history as reusable. */
  requireCommits?: readonly string[];
  throughMessageId?: string;
}): Promise<UnitAuthoringHistoryPrefix | UnitAuthoringHistoryMiss> {
  const userId = input.userId?.trim();
  const unitId = input.unitId?.trim();
  const goalId = input.goalId?.trim();
  if (!userId || !unitId || !goalId) {
    return { available: false, reason: "missing_scope" };
  }
  try {
    const session = await ensureUnitAuthoringSession({
      userId,
      unitId,
      goalId,
    });
    const messages = input.throughMessageId
      ? await snapshotUnitAuthoringBranch({
          threadId: session.threadId,
          throughMessageId: input.throughMessageId,
        })
      : await loadUnitAuthoringTranscript(session.threadId);
    if (messages.length === 0) {
      return { available: false, reason: "empty_transcript" };
    }
    for (const toolName of input.requireCommits ?? ["commit_survey"]) {
      if (toolName === "commit_section_material") {
        if (!transcriptHasCompletedTopicMaterial(messages)) {
          return { available: false, reason: "missing_commit" };
        }
        continue;
      }
      if (!transcriptHasToolCommit(messages, toolName)) {
        return { available: false, reason: "missing_commit" };
      }
    }
    return {
      available: true,
      threadId: session.threadId,
      state: session.state,
      messages: filterUnitAuthoringTranscriptForDownstream(messages),
    };
  } catch {
    return { available: false, reason: "session_error" };
  }
}

/** True when a prior authoring transcript can ground a downstream unit call. */
export function unitAuthoringHistoryReusable(
  history: UnitAuthoringHistoryPrefix | UnitAuthoringHistoryMiss,
): history is UnitAuthoringHistoryPrefix {
  return history.available;
}

export const unitAuthoringDownstreamEnvelopeSchema = z.object({
  items: z.array(z.unknown()),
});
