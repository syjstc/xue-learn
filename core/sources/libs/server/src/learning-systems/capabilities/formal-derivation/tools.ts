import { defineAgentTool } from "../../../agents/core/tools.js";
import type { AgentRunContext } from "../../../agents/core/types.js";
import {
  commitDerivationStepForRun,
  commitExpansionStepForRun,
  validateAndFinishDerivationForRun,
  finishExpansionForRun,
  inspectDerivationForRun,
  inspectExpansionForRun,
  validateDerivationForRun,
  validateExpansionForRun,
} from "./session.js";
import {
  commitDerivationStepArgsSchema,
  finishDerivationArgsSchema,
  finishExpansionArgsSchema,
  inspectDerivationArgsSchema,
  validateDerivationArgsSchema,
} from "./schema.js";

function boundRunId(ctx: AgentRunContext): string {
  const runId = ctx.toolSubject?.threadId ?? ctx.threadId;
  if (!runId) {
    throw new Error("Formal derivation tools require a bound run id");
  }
  return runId;
}

// Apply only at the LLM transcript boundary. UI events need the full step.
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

export function createFormalDerivationTools() {
  const inspectDerivation = defineAgentTool({
    name: "inspect_derivation",
    description:
      "Return the current derivation revision, formula IDs/revisions, compact authoring trees, presentation state, open case-split cursor (branch), facts, and remaining limits. Call this instead of guessing IDs.",
    schema: inspectDerivationArgsSchema,
    handler: async (_args, ctx) => inspectDerivationForRun(boundRunId(ctx)),
  });

  const commitDerivationStep = defineAgentTool({
    name: "commit_derivation_step",
    description:
      'Atomically commit one minimal teaching step on the linear timeline (one algebraic or notational rewrite; summary names that action). Keep an existing formulaId for rewrites; prefer swap_subtrees, substitute/substitute_many, or relocate_subtree before replace_subtree. relocate_subtree preserves listed moving node identities across a structural move. Use formula.add only for a genuinely new statement. Authoring trees are kind-discriminated: token.value, operator.token+operands, container.renderer+slots. Division must be a fraction container (stack, separator true, slots numerator / ― fraction-bar / denominator); a two-slot fraction, infix /, or a Leibniz apply token dy/dx is repaired on commit. Square roots use renderer "radical" with surround symbol √; a sqrt surround that put √ in left is recovered. Integrals use renderer "integral"; a bare ∫ or int token is recovered. actions may be empty when presentation contains narration, focus, highlight, dim, reveal, or pause. For case analysis, set branch.role to split, case, or join; cases still commit one after another. The server binds the run id.',
    schema: commitDerivationStepArgsSchema,
    handler: async (args, ctx) =>
      commitDerivationStepForRun(boundRunId(ctx), args, ctx.traceId),
  });

  const validateDerivation = defineAgentTool({
    name: "validate_derivation",
    description:
      "Replay the script and return schema, formal, and mathematical findings without repairing it. Rejects malformed quantifiers, a product of a sum/difference that is not wrapped in a group, e.g. m·x-a instead of m(x-a), and a stacked fraction that still has no bar after presentation recovery.",
    schema: validateDerivationArgsSchema,
    handler: async (_args, ctx) => validateDerivationForRun(boundRunId(ctx)),
  });

  const finishDerivation = defineAgentTool({
    name: "finish_derivation",
    description:
      "Validate the current revision and, only if validation passes, mark it complete. Pass the latest derivationRevision as validatedRevision. Returns findings for repair on failure; a separate validate_derivation call is optional. Store a learner-safe summary.",
    schema: finishDerivationArgsSchema,
    handler: async (args, ctx) =>
      validateAndFinishDerivationForRun(boundRunId(ctx), args),
  });

  return [
    inspectDerivation,
    commitDerivationStep,
    validateDerivation,
    finishDerivation,
  ];
}

export function createFormalDerivationExpansionTools() {
  const inspectDerivation = defineAgentTool({
    name: "inspect_derivation",
    description:
      "Return the expansion buffer, the replaced step, requiredSeam (commit-legal after-state trees you must recreate), remaining expansion/run step budgets, formula IDs/revisions, and current presentation. Copy requiredSeam.formulas[].tree for the final seam; use live buffer formulas for transform node ids. Call this instead of guessing IDs.",
    schema: inspectDerivationArgsSchema,
    handler: async (_args, ctx) => inspectExpansionForRun(boundRunId(ctx)),
  });

  const commitDerivationStep = defineAgentTool({
    name: "commit_derivation_step",
    description:
      "Commit one finer, minimal teaching step into the expansion buffer, not the parent timeline. Keep the existing formulaId and prefer swap, substitution, or relocation transforms over subtree reconstruction. Temporary formula.add must be hidden before finish_expansion. The server copies the replaced step's case tags when missing.",
    schema: commitDerivationStepArgsSchema,
    handler: async (args, ctx) =>
      commitExpansionStepForRun(boundRunId(ctx), args, ctx.traceId),
  });

  const validateDerivation = defineAgentTool({
    name: "validate_derivation",
    description:
      "Check that the expansion buffer splices onto the parent timeline: same original formula trees, facts, and visibility at the seam. Does not write the parent run.",
    schema: validateDerivationArgsSchema,
    handler: async (_args, ctx) => validateExpansionForRun(boundRunId(ctx)),
  });

  const finishExpansion = defineAgentTool({
    name: "finish_expansion",
    description:
      "Replace the original step with the expansion buffer on the parent linear timeline after a successful validate_derivation. Later steps are kept and their clocks are rewritten by the server.",
    schema: finishExpansionArgsSchema,
    handler: async (_args, ctx) => finishExpansionForRun(boundRunId(ctx)),
  });

  return [
    inspectDerivation,
    commitDerivationStep,
    validateDerivation,
    finishExpansion,
  ];
}
