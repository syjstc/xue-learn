import { z } from 'zod';
import { teachingDerivationStepSchema } from "./schema.js";
import { compileTeachingPresentation, teachingPresentationHash } from "./teaching-plan.js";
import type { TeachingDerivationDocumentV1 } from "./types.js";
import {teachingVisualIssues} from "./visual.js";

export const teachingEnhancementSchema = z.object({
  steps: z.array(teachingDerivationStepSchema.pick({ index: true, targets: true, cues: true, intents: true }).extend({ index: z.number().int().min(1).max(80) })).min(1).max(80),
});
export type TeachingEnhancement = z.infer<typeof teachingEnhancementSchema>;

/** Metadata-only patch. Never trust model copies of the formula board or narration. */
export function applyTeachingEnhancement(document: TeachingDerivationDocumentV1, input: TeachingEnhancement, expectedHash: string): TeachingDerivationDocumentV1 {
  if (expectedHash !== teachingPresentationHash(document)) throw new Error('Presentation source revision changed');
  const indexes = new Set(input.steps.map(s => s.index));
  if (indexes.size !== input.steps.length || input.steps.some(s => !document.steps[s.index - 1])) throw new Error('Enhancement step indexes are invalid');
  const steps = document.steps.map(step => {
    const metadata = input.steps.find(s => s.index === step.index);
    if (!metadata) return step;
    if (!metadata.cues?.length || metadata.cues.map(c => c.text).join('') !== step.narration) throw new Error(`Step ${step.index}: enhancement must preserve narration byte for byte`);
    const candidate = { ...step, targets: metadata.targets, cues: metadata.cues, intents: metadata.intents };
    const plan = compileTeachingPresentation(document, candidate);
    const issues = [...plan.issues, ...teachingVisualIssues(document, candidate)];
    if (issues.length) throw new Error(JSON.stringify({ step: step.index, issues }));
    return candidate;
  });
  return {
    ...document, steps, revision: document.revision + 1,
    presentationBackup: document.presentationBackup ?? document.steps.map(({ index, targets, cues, intents }) => ({ index, targets, cues, intents })),
  };
}
export function restoreTeachingPresentation(document: TeachingDerivationDocumentV1): TeachingDerivationDocumentV1 {
  if (!document.presentationBackup) throw new Error('No previous presentation to restore');
  const { presentationBackup, ...rest } = document;
  return { ...rest, revision: document.revision + 1, steps: document.steps.map(step => {
    const original = presentationBackup.find(s => s.index === step.index);
    if (!original) throw new Error('Presentation backup no longer matches the document');
    return { ...step, targets: original.targets, cues: original.cues, intents: original.intents };
  }) };
}
