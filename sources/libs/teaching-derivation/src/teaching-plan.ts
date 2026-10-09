import { recognizeStructuralAction } from "./structural-actions.js";
import { analyzeFormula, hashSource, walkFormulaNodes, type ChildRole, type FormulaAnalysis, type FormulaNode } from "../../formula-analysis/src/index.js";
import type { TeachingDerivationDocumentV1, TeachingDerivationStepV1 } from "./types.js";
import { latexTypesetError } from "./typeset.js";

export const TEACHING_PRESENTATION_VERSION = 'teaching-presentation.v3';
export type TeachingTarget = Readonly<{
  id: string;
  formulaKey: string;
  state: 'before' | 'after';
  latex: string;
  path?: readonly Readonly<{ role: ChildRole; index?: number }>[];
}>;
export type TeachingCue = Readonly<{
  id: string;
  text: string;
  targetIds: readonly string[];
  startTransform?: boolean;
  onScreenText?: string;
  givenIndexes?: readonly number[];
  visualTargetIds?: readonly string[];
}>;
export type TeachingIntent = Readonly<{
  kind: 'move' | 'swap' | 'replace' | 'cancel' | 'expand' | 'merge';
  before: readonly string[];
  after: readonly string[];
}>;
export type ResolvedTeachingTarget = TeachingTarget & Readonly<{
  sourceHash: string;
  nodeId: string;
  range: Readonly<{ start: number; end: number }>;
  /** Exact complete formula focus does not claim understood internal structure. */
  wholeFormula?: true;
}>;
export type TeachingPlanIssue = Readonly<{
  code: 'target_missing' | 'target_ambiguous' | 'target_unsupported' | 'cue_invalid' | 'intent_mismatch';
  message: string;
  targetId?: string;
  candidates?: readonly Readonly<{ latex: string; path: TeachingTarget['path'] }>[];
}>;
export type TeachingPresentationPlan = Readonly<{
  version: string;
  targets: readonly ResolvedTeachingTarget[];
  cues: readonly TeachingCue[];
  issues: readonly TeachingPlanIssue[];
  actions: readonly { kind: TeachingIntent["kind"]; formulaKey: string; pairs: readonly { beforeNodeId: string; afterNodeId: string }[]; cancelledNodeIds: readonly string[] }[];
}>;
const normalized = (latex: string) => latex.replace(/\s+/g, '');

export function resolveTeachingTarget(analysis: FormulaAnalysis, target: TeachingTarget): { target?: ResolvedTeachingTarget; issue?: TeachingPlanIssue } {
  const entries: { node: FormulaNode; path: NonNullable<TeachingTarget['path']> }[] = [];
  const visit = (node: FormulaNode, path: NonNullable<TeachingTarget['path']>) => {
    const ranges = node.sourceRanges;
    const bounded = ranges.length ? [{ start: Math.min(...ranges.map(r => r.start)), end: Math.max(...ranges.map(r => r.end)) }] : [];
    entries.push({ node: { ...node, sourceRanges: bounded }, path });
    const counts = new Map<ChildRole, number>();
    for (const child of node.children) {
      const index = counts.get(child.role) ?? 0;
      counts.set(child.role, index + 1);
      visit(child.node, [...path, { role: child.role, index }]);
    }
  };
  visit(analysis.root, []);
  const matches = entries.filter(({ node, path }) => {
    if (node.sourceRanges.length !== 1) return false;
    const range = node.sourceRanges[0]!;
    if (normalized(analysis.source.slice(range.start, range.end)) !== normalized(target.latex)) return false;
    return !target.path || (target.path.length === path.length && target.path.every((part, i) => part.role === path[i]?.role && (part.index == null || part.index === path[i]?.index)));
  });
  // Parser wrappers may own the identical concrete span. They are one visible target.
  const unique = [...new Map(matches.map(item => [`${item.node.sourceRanges[0]!.start}:${item.node.sourceRanges[0]!.end}`, item])).values()];
  if (unique.length !== 1) return { issue: {
    code: unique.length ? 'target_ambiguous' : 'target_missing', targetId: target.id,
    message: unique.length ? 'This fragment occurs more than once. Choose an explicit structural path.' : 'The fragment does not identify a complete parsed region in this formula.',
    candidates: unique.map(({ node, path }) => ({ latex: analysis.source.slice(node.sourceRanges[0]!.start, node.sourceRanges[0]!.end), path })),
  } };
  const whole = normalized(target.latex) === normalized(analysis.source)
    ? matches.find(entry => entry.path.length === 0) : undefined;
  const node = whole?.node ?? unique[0]!.node;
  // Identifying the exact whole formula is a visual operation, independent of
  // whether f(x) means a function or multiplication. Never widen a fragment,
  // ignore an authored path, or accept broken TeX to recover a target.
  const wholeFormula = node.parseStatus !== 'recognized' && Boolean(whole)
    && analysis.syntaxStatus === 'ok' && latexTypesetError(analysis.source) === null;
  if (node.parseStatus !== 'recognized' && !wholeFormula) return { issue: { code: 'target_unsupported', targetId: target.id, message: 'This region is ambiguous or opaque; declare variable/function symbols or target the exact complete formula for whole-formula focus and replace only.' } };
  return { target: { ...target, sourceHash: analysis.sourceHash, nodeId: node.nodeId, range: node.sourceRanges[0]!, ...(wholeFormula ? {wholeFormula: true as const} : {}) } };
}

export function teachingTargetAnalysis(document: TeachingDerivationDocumentV1, step: TeachingDerivationStepV1, target: TeachingTarget): FormulaAnalysis | undefined {
  const formula = step.board.find(f => f.key === target.formulaKey);
  if (!formula) return;
  const source = formula.source ?? { stepIndex: step.index - 1, formulaKey: formula.key };
  const latex = target.state === 'after' ? formula.latex : document.steps[source.stepIndex - 1]?.board.find(f => f.key === source.formulaKey)?.latex;
  return latex == null ? undefined : analyzeFormula(latex, { symbols: document.symbols });
}

export function compileTeachingPresentation(document: TeachingDerivationDocumentV1, step: TeachingDerivationStepV1): TeachingPresentationPlan {
  const targets: ResolvedTeachingTarget[] = [];
  const issues: TeachingPlanIssue[] = [];
  const ids = new Set<string>();
  for (const target of step.targets ?? []) {
    if (ids.has(target.id)) { issues.push({ code: 'target_ambiguous', targetId: target.id, message: 'Target IDs must be unique within the step.' }); continue; }
    ids.add(target.id);
    const analysis = teachingTargetAnalysis(document, step, target);
    if (!analysis) { issues.push({ code: 'target_missing', targetId: target.id, message: 'The formula or its committed predecessor is missing.' }); continue; }
    const resolved = resolveTeachingTarget(analysis, target);
    if (resolved.target) targets.push(resolved.target);
    if (resolved.issue) issues.push(resolved.issue);
  }
  const cues = step.cues ?? [];
  const cueIds = new Set<string>();
  const hasTrigger = cues.some(c => c.startTransform);
  let started = !hasTrigger;
  for (const cue of cues) {
    if (cueIds.has(cue.id) || cue.targetIds.some(id => !targets.some(t => t.id === id))) issues.push({ code: 'cue_invalid', message: `Cue ${cue.id} has a duplicate ID or unresolved target.` });
    cueIds.add(cue.id);
    if (cue.startTransform && started) issues.push({ code: 'cue_invalid', message: 'Only one cue can start the step transformation.' });
    if (cue.startTransform) started = true;
    if (cue.targetIds.some(id => targets.some(t => t.id === id && t.state === (started ? 'before' : 'after') && !(step.board.find(f => f.key === t.formulaKey)?.role === 'reference' && t.state === 'after')))) issues.push({ code: 'cue_invalid', message: `Cue ${cue.id} targets a state that is not visible during this cue. Before targets precede the trigger; after targets accompany or follow it.` });
  }
  const actions: TeachingPresentationPlan["actions"][number][] = [];
  for (const intent of step.intents ?? []) {
    const before = intent.before.map(id => targets.find(t => t.id === id && t.state === 'before'));
    const after = intent.after.map(id => targets.find(t => t.id === id && t.state === 'after'));
    let valid = before.length > 0 && after.length > 0 && before.every(Boolean) && after.every(Boolean);
    if (valid && intent.kind !== 'replace' && [...before, ...after].some(target => target!.wholeFormula)) valid = false;
    if (valid && (intent.kind === 'move' || intent.kind === 'swap')) valid = before.length === after.length && before.every((t, i) => normalized(t!.latex) === normalized(after[i]!.latex));
    let action: { pairs: { beforeNodeId: string; afterNodeId: string }[]; cancelledNodeIds: string[] } | undefined;
    if (valid && (intent.kind === 'cancel' || intent.kind === 'expand' || intent.kind === 'merge')) {
      if (before.length !== 1 || after.length !== 1 || before[0]!.formulaKey !== after[0]!.formulaKey) valid = false;
      else {
        const oldAnalysis = teachingTargetAnalysis(document, step, before[0]!)!;
        const newAnalysis = teachingTargetAnalysis(document, step, after[0]!)!;
        action = recognizeStructuralAction(intent.kind,
          walkFormulaNodes(oldAnalysis.root).find(n => n.nodeId === before[0]!.nodeId)!,
          walkFormulaNodes(newAnalysis.root).find(n => n.nodeId === after[0]!.nodeId)!, Boolean(step.conditions?.trim()));
        valid = !!action;
      }
    }
    if (valid) actions.push({ kind: intent.kind, formulaKey: before[0]!.formulaKey,
      pairs: action?.pairs ?? (intent.kind === 'replace' ? [] : before.map((t, i) => ({ beforeNodeId: t!.nodeId, afterNodeId: after[i]!.nodeId }))),
      cancelledNodeIds: action?.cancelledNodeIds ?? [],
    });
    if (!valid) issues.push({ code: 'intent_mismatch', message: `The ${intent.kind} intention has no verified structural correspondence. Split the step or use replace without claiming an algebraic animation.` });
  }
  return { version: TEACHING_PRESENTATION_VERSION, targets, cues, issues, actions };
}

export function teachingPresentationHash(document: TeachingDerivationDocumentV1): string {
  return hashSource(JSON.stringify(document));
}

/** Public selector catalogue contains source fragments and semantic paths, not node IDs. */
export function teachingTargetCatalogue(document: TeachingDerivationDocumentV1, step: TeachingDerivationStepV1): TeachingTarget[] {
  const targets: TeachingTarget[] = [];
  for (const formula of step.board) for (const state of ['after', 'before'] as const) {
    const seed: TeachingTarget = { id: 'candidate', formulaKey: formula.key, state, latex: formula.latex };
    const analysis = teachingTargetAnalysis(document, step, seed);
    if (!analysis) continue;
    const visit = (node: FormulaNode, path: NonNullable<TeachingTarget['path']>) => {
      if (targets.length >= 192) return;
      const ranges = node.sourceRanges;
      if (ranges.length && (node.parseStatus === 'recognized' || path.length === 0)) {
        const start = Math.min(...ranges.map(r => r.start)), end = Math.max(...ranges.map(r => r.end));
        const target: TeachingTarget = { ...seed, id: `target${targets.length + 1}`, latex: analysis.source.slice(start, end), path };
        if (resolveTeachingTarget(analysis, target).target) targets.push(target);
      }
      const counts = new Map<ChildRole, number>();
      for (const child of node.children) { const index = counts.get(child.role) ?? 0; counts.set(child.role, index + 1); visit(child.node, [...path, {role:child.role,index}]); }
    };
    visit(analysis.root, []);
  }
  return targets;
}
