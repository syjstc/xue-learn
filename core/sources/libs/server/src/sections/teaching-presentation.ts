import { z } from "zod";
import type { UnitSectionPlanRepository } from "../../../domain/src/index.js";
import { applyTeachingEnhancement, compileTeachingDerivation, parseTeachingDerivationDocument, restoreTeachingPresentation, teachingEnhancementSchema, teachingPresentationHash, teachingTargetCatalogue, type TeachingEnhancement } from "../../../teaching-derivation/src/index.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { runWithUserId } from "../user-context.js";

const metadataSchema = z.object({ steps: z.array(teachingEnhancementSchema.shape.steps.element.omit({ cues: true, targets: true }).extend({
  cues: z.array(z.object({ id: z.string(), targetIds: z.array(z.string()).max(8), startTransform: z.boolean().optional() })).min(1).max(32),
})).min(1).max(1) });
export function originalTeachingSpeechSegments(text: string): { id: string; text: string }[] {
  const chunks = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*|[。！？!?；;\n]+/gu) ?? [text];
  const parts: string[] = [];
  for (const chunk of chunks) {
    let remaining = chunk;
    while (remaining.length > 240) { let end = 240; if (/[\uD800-\uDBFF]/u.test(remaining[end - 1]!)) end--; parts.push(remaining.slice(0, end)); remaining = remaining.slice(end); }
    if (remaining) parts.push(remaining);
  }
  return parts.map((text, index) => ({ id: `cue${index + 1}`, text }));
}

export async function enhanceTeachingPresentation(params: {
  repository: UnitSectionPlanRepository; userId: string; unitId: string; sectionId: string;
  expectedRevision: number; action: 'enhance' | 'restore';
  onProgress?: (step: number, total: number) => void;
}) {
  const source = await params.repository.findSectionContent(params);
  if (!source?.sectionFound || !source.teachingDerivationJson) throw new Error('Teaching derivation not found');
  if (source.contentRevision !== params.expectedRevision) throw new Error('Presentation content revision changed');
  const original = parseTeachingDerivationDocument(JSON.parse(source.teachingDerivationJson));
  if (!original || original.status !== 'complete') throw new Error('Complete the teaching derivation before enhancing its presentation');
  const hash = teachingPresentationHash(original);
  let document = original;
  if (params.action === 'restore') document = restoreTeachingPresentation(original);
  else {
    const patches: TeachingEnhancement['steps'] = [];
    for (const step of original.steps) {
      const segments = originalTeachingSpeechSegments(step.narration);
      const catalogue = teachingTargetCatalogue(original, step);
      let lastError = '';
      let accepted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const prompt = [
          'Enhance ONLY presentation metadata for the given existing teaching step. Return exactly this step index, cues, and optional intents.',
          'Never rewrite formulas, their keys, lineage, titles, order, conditions, justification or narration. Narration is segmented by the server. Return exactly the supplied segment IDs in the same order, with targetIds and optional startTransform; do not return any text.',
          'Choose targetIds ONLY from the supplied target catalogue. The catalogue already resolves exact source fragments and structural positions. Do not return targets, LaTeX, paths or parser node IDs. Choose the smallest meaningful region that the speech actually explains; keep unrelated symbols unhighlighted.',
          'Use one startTransform cue if this step changes its primary formula; before that cue highlight before targets, from that cue on highlight after targets. Use no startTransform for narrate_only. If lineage is absent, do not invent it: only highlight current formulas with no trigger.',
          'Optional intents pair before and after targets: move/swap keep exact fragments; replace changes a region. cancel only a common multiplicative factor in a fraction with stated conditions; expand/merge only a verified distributive product/sum. Omit unsupported algebraic intentions.',
          JSON.stringify({ targetCatalogue: catalogue, segments, step, previous: original.steps[step.index - 2] ?? null, sources: step.board.flatMap(f => f.source ? [original.steps[f.source.stepIndex - 1]] : []), symbols: original.symbols }),
          lastError ? `The previous proposal failed validation. Repair these issues: ${lastError}` : '',
        ].join('\n\n');
        try {
        const generated = await runWithUserId(params.userId, () => runValidatedStructuredGeneration({
          mode: 'object', schema: metadataSchema, prompt,
          options: { operation: 'unit.teaching_derivation.enhance', bindingSchema: metadataSchema, meta: { unitId: params.unitId, sectionId: params.sectionId, stepIndex: step.index } },
          contextSubject: { userId: params.userId, unitId: params.unitId },
          contextQuery: prompt, contextInvocation: { stepIndex: step.index },
        }));
          if (generated.steps.length !== 1 || generated.steps[0]?.index !== step.index) throw new Error('Return only the requested step');
          const metadata = generated.steps[0]!;
          if (metadata.cues.length !== segments.length || metadata.cues.some((cue, index) => cue.id !== segments[index]?.id)) throw new Error('Keep all supplied cue IDs in the original order');
          const selected = new Set([...metadata.cues.flatMap(c => c.targetIds), ...(metadata.intents ?? []).flatMap(i => [...i.before, ...i.after])]);
          if (catalogue.length && !metadata.cues.some(c => c.targetIds.length)) throw new Error('Bind at least one spoken cue to a meaningful catalogue target');
          if ([...selected].some(id => !catalogue.some(t => t.id === id))) throw new Error("Choose only supplied catalogue target IDs");
          const patch = teachingEnhancementSchema.parse({ steps: [{ ...metadata, targets: catalogue.filter(t => selected.has(t.id)), cues: metadata.cues.map((cue, index) => ({ ...cue, text: segments[index]!.text })) }] });
          applyTeachingEnhancement(original, patch, hash);
          patches.push(...patch.steps);
          accepted = true;
          break;
        } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
      }
      if (!accepted) throw new Error(`Step ${step.index} needs attention after two repairs: ${lastError}`);
      params.onProgress?.(step.index, original.steps.length);
    }
    document = applyTeachingEnhancement(original, { steps: patches }, hash);
  }
  const derived = compileTeachingDerivation(document);
  const saved = await params.repository.updateTeachingPresentation({ ...params,
    expectedContentRevision: source.contentRevision, expectedDocumentJson: source.teachingDerivationJson,
    documentJson: JSON.stringify(document), derivedJson: JSON.stringify(derived),
  });
  if (!saved) throw new Error('Presentation content revision changed; the original course was preserved');
  return { document, derived, contentRevision: source.contentRevision + 1 };
}

export async function pendingTeachingPresentation(params: { repository: UnitSectionPlanRepository; userId: string; unitId: string; sectionId: string }) {
  if (!await params.repository.findGenerationSource(params)) throw new Error('Teaching derivation not found');
  const { requireTeachingDerivationPersistence } = await import("../learning-systems/capabilities/teaching-derivation/persistence.js");
  const runs = await requireTeachingDerivationPersistence().listRunsBySection(params.sectionId);
  const run = runs.find(r => r.ownerUserId === params.userId && r.unitId === params.unitId && r.status === 'needs_attention');
  if (!run?.validationSummaryJson) return null;
  const summary = JSON.parse(run.validationSummaryJson);
  const document = parseTeachingDerivationDocument(JSON.parse(run.documentJson));
  if (!document || !summary.pendingStep || summary.revision !== run.revision) return null;
  const preview = parseTeachingDerivationDocument({ ...document, steps: [...document.steps, summary.pendingStep] });
  if (!preview) return null;
  return { runId: run.id, revision: run.revision, hash: teachingPresentationHash(preview), document: preview, issues: summary.issues };
}

export async function acceptConservativeTeachingPresentation(params: { repository: UnitSectionPlanRepository; userId: string; unitId: string; sectionId: string; revision: number; hash: string }) {
  const pending = await pendingTeachingPresentation(params);
  if (!pending || pending.revision !== params.revision || pending.hash !== params.hash) throw new Error('Pending presentation revision changed');
  const { commitTeachingStepForRun } = await import("../learning-systems/capabilities/teaching-derivation/session.js");
  const { targets: _targets, cues: _cues, intents: _intents, ...step } = pending.document.steps.at(-1)!;
  const result = await commitTeachingStepForRun(pending.runId, step, JSON.stringify(pending.issues).slice(0, 2000), params.revision);
  if (!result.ok) throw new Error('The pending step could not be accepted');
  return { accepted: true };
}
