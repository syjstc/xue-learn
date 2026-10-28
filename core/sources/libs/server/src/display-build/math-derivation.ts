import type { LearningSystemRuntime } from "../learning-systems/runtime.js";
import { z } from "zod";
import type { DisplayBuilder } from "./service.js";

export const mathDerivationBuildInputSchema = z.object({
  title: z.string().trim().min(1).max(200), requirement: z.string().trim().min(1), locale: z.string().optional(),
  unitId: z.string().min(1), unitTitle: z.string().optional(), sourceContext: z.string().optional(),
});

/** Reuses the ordinary persisted step agent, independently of section publication. */
export function createMathDerivationBuilder(runtime?: LearningSystemRuntime): DisplayBuilder {
  return {
  kind: "math:derivation", version: 1,
  async build({run, signal, saveCheckpoint}) {
    const input = mathDerivationBuildInputSchema.parse(run.input);
    const checkpoint = (run.checkpoint ?? {}) as {runId?: string};
    const [{generateTeachingDerivationDocument}, {runWithUserId}, {compileTeachingDerivation}] = await Promise.all([
      import("../sections/teaching-derivation-generation.js"), import("../user-context.js"), import("../../../teaching-derivation/src/index.js"),
    ]);
    let childRunId = checkpoint.runId;
    const {document} = await runWithUserId(run.ownerUserId, () => generateTeachingDerivationDocument({
      runtime, userId: run.ownerUserId, unitId: input.unitId, token: run.leaseToken!, locale: input.locale ?? "zh-Hans",
      unitTitle: input.unitTitle ?? input.title, sectionTitle: input.title,
      contentSummary: [input.requirement, input.sourceContext].filter(Boolean).join("\n\n"),
      runId: childRunId, runScope: {kind: "display-build", jobId: run.id, sourceHash: run.sourceHash, revision: run.inputRevision},
      signal,
      onRunPrepared: async runId => {childRunId = runId; await saveCheckpoint({runId});},
      onPartialTeachingDerivation: async (document, derived) => {
        await saveCheckpoint({runId: childRunId, document, derived, completedSteps: document.steps.length, revision: document.revision});
      },
    }));
    return {document, derived: compileTeachingDerivation(document)};
  },
  };
}

export const mathDerivationBuilder = createMathDerivationBuilder();
