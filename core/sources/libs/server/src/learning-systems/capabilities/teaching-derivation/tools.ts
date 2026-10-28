import { defineAgentTool } from "../../../agents/core/tools.js";
import type { AgentRunContext } from "../../../agents/core/types.js";
import {
  commitTeachingStepForRun,
  finishTeachingDerivationForRun,
  inspectTeachingDerivationForRun,
} from "./session.js";
import {
  commitTeachingStepArgsSchema,
  finishTeachingDerivationArgsSchema,
  inspectTeachingDerivationArgsSchema,
} from "../../../../../teaching-derivation/src/index.js";

function boundRunId(ctx: AgentRunContext): string {
  const runId = ctx.toolSubject?.threadId ?? ctx.threadId;
  if (!runId) {
    throw new Error("Teaching derivation tools require a bound run id");
  }
  return runId;
}

export function compactCommitToolResponse(response: unknown): unknown {
  if (
    !response ||
    typeof response !== "object" ||
    !("ok" in response) ||
    response.ok !== true ||
    !("continuation" in response) ||
    !response.continuation ||
    typeof response.continuation !== "object"
  )
    return response;
  return { ok: true, ...response.continuation };
}

export function createTeachingDerivationTools() {
  const inspectTeachingDerivation = defineAgentTool({
    name: "inspect_teaching_derivation",
    description:
      "Return the current teaching-derivation revision, committed step indexes, formula keys, and remaining limits. Call this instead of guessing earlier keys.",
    schema: inspectTeachingDerivationArgsSchema,
    handler: async (_args, ctx) => inspectTeachingDerivationForRun(boundRunId(ctx)),
  });

  const commitTeachingStep = defineAgentTool({
    name: "commit_teaching_step",
    description:
      "Commit one complete teaching step: full board formulas in LaTeX, teaching relation, references, justification, and classroom narration. The server copies reference latex, parses formulas, and compiles animation. Optional teachingGoal, givens, and symbols update the document header.",
    schema: commitTeachingStepArgsSchema,
    handler: async (args, ctx) => commitTeachingStepForRun(boundRunId(ctx), args),
  });

  const finishTeachingDerivation = defineAgentTool({
    name: "finish_teaching_derivation",
    description:
      "Mark the teaching derivation complete after at least one committed step. Store a short learner-safe summary.",
    schema: finishTeachingDerivationArgsSchema,
    handler: async (args, ctx) =>
      finishTeachingDerivationForRun(boundRunId(ctx), args),
  });

  return [
    inspectTeachingDerivation,
    commitTeachingStep,
    finishTeachingDerivation,
  ];
}
