import { compileTeachingDerivation } from "./compile.js";
import type { TeachingDerivationDocumentV1, TeachingDerivationStepV1 } from "./types.js";
export function assessTeachingPresentation(document: TeachingDerivationDocumentV1, step: TeachingDerivationStepV1) {
  const derived = compileTeachingDerivation({ ...document, steps: [...document.steps.filter(s => s.index < step.index), step] }).steps.at(-1)!;
  const issues: { code: string; message: string }[] = [...(derived.presentation?.issues ?? [])];
  const changed = step.board.filter(f => f.role === 'primary' && f.change !== 'introduce' && (() => {
    const source = f.source ?? { stepIndex: step.index - 1, formulaKey: f.key };
    return document.steps[source.stepIndex - 1]?.board.find(p => p.key === source.formulaKey)?.latex !== f.latex;
  })());
  const critical = changed.length > 0 && (['equivalence', 'imply', 'substitute'].includes(step.relation) || Boolean(step.intents?.length));
  if (critical) {
    if (!step.cues?.some(c => c.startTransform)) issues.push({ code: 'missing_transform_cue', message: 'A key teaching transformation needs one cue that starts it.' });
    for (const formula of changed) {
      const targets = derived.presentation?.targets.filter(t => t.formulaKey === formula.key) ?? [];
      if (!targets.some(t => t.state === 'before') || !targets.some(t => t.state === 'after')) issues.push({ code: 'missing_local_targets', message: `Formula ${formula.key} needs resolved before and after teaching targets.` });
      const transition = derived.transitions.find(t => t.formulaKey === formula.key);
      const localTarget = targets.some(t => t.state === 'after' && t.range.end - t.range.start < formula.latex.length);
      if (transition?.transition.animationStatus === 'formula' && !localTarget && !derived.presentation?.actions.some(a => a.formulaKey === formula.key && a.pairs.length)) issues.push({ code: 'formula_only_fallback', message: `Formula ${formula.key} only has a whole-formula transition. Split the transformation or select a meaningful local region.` });
    }
  }
  const targets = derived.presentation?.targets.length ?? 0;
  const totalTargets = step.targets?.length ?? 0;
  return { critical, issues, metrics: { targets, totalTargets, targetSuccessRate: totalTargets ? targets / totalTargets : null, localTransitions: derived.transitions.filter(t => t.transition.animationStatus === 'node').length, formulaFallbacks: derived.transitions.filter(t => t.transition.animationStatus === 'formula').length } };
}
