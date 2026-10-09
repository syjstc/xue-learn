import {materialTeachingCueIssues, materialTeachingSteps, materialTeachingTarget, type MaterialTeaching} from "./material-teaching.js";
import {materialTeachingFocusTargets, materialTeachingFocusTarget} from "./material-teaching-focus.js";
import {sampleMaterialTeachingTimeline} from "./material-teaching-motion.js";
import {resolveParagraphCue} from "./material-cue.js";
import {materialTeachingTreeIssues} from "./material-teaching-validation.js";

const forces: MaterialTeaching = {type:'teaching', version:1, id:'forces_board', title:'受力分析', templateId:'physics-forces', content:{mass:3, drive:12, resistance:6, duration:4}};
const focus = (id: string) => materialTeachingFocusTarget(forces.id, id);
const intervals = [
  {targetIds:[materialTeachingTarget(forces.id, 'forces'), focus('mass')], startTick:0, durationTicks:96_000},
  {targetIds:[materialTeachingTarget(forces.id, 'forces'), focus('applied-force')], startTick:96_000, durationTicks:96_000},
  {targetIds:[materialTeachingTarget(forces.id, 'forces'), focus('applied-force')], startTick:192_000, durationTicks:96_000},
  {targetIds:[forces.id], startTick:288_000, durationTicks:96_000},
];

test('subtarget changes move attention while the same operation and original evidence stay fixed', () => {
  const original = JSON.stringify(forces);
  const sample = (tick: number) => sampleMaterialTeachingTimeline(forces, intervals, tick);
  const before = sample(90_000), onset = sample(101_000), held = sample(160_000);
  expect(before.focusTargets?.find(x => x.id === 'mass')?.focus).toBe(1);
  expect(onset.stepId).toBe('forces');
  expect(onset.frame).toBe(before.frame);
  expect(onset.progress).toBe(1);
  expect(onset.focusTargets?.find(x => x.id === 'applied-force')?.focus).toBeGreaterThan(0);
  expect(onset.focusTargets?.find(x => x.id === 'applied-force')?.focus).toBeLessThan(1);
  expect(onset.focusTargets?.find(x => x.id === 'mass')).toBeUndefined();
  expect(sample(193_000)).toEqual(held);
  expect(sample(300_000).focusTargets).toEqual([]);
  sample(350_000);
  expect(sample(101_000)).toEqual(onset);
  expect(JSON.stringify(forces)).toBe(original);
});

test('scope stays attached to its own figure and wrong-operation focus is rejected', () => {
  const display = {type:'stage', id:'stage', layout:'split-h', figures:[forces, {...forces, id:'other'}]};
  const cue = resolveParagraphCue(display, {target:'left', figureId:forces.id, targetIds:[materialTeachingTarget(forces.id, 'forces'), focus('mass')]});
  expect(cue?.targetIds).toContain(focus('mass'));
  expect(cue?.targetIds).not.toContain(materialTeachingFocusTarget('other', 'mass'));
  const cues = materialTeachingSteps(forces).map(step => ({targetIds:[step.id]}));
  expect(materialTeachingCueIssues(forces, cues)).toEqual([]);
  expect(materialTeachingCueIssues(forces, [{targetIds:['forces','mass']}, ...cues.slice(1)])).toEqual([]);
  expect(materialTeachingCueIssues(forces, [{targetIds:['forces','velocity']}, ...cues.slice(1)]).join(' ')).toContain('focus velocity');
  expect(materialTeachingCueIssues(forces, [{targetIds:['mass']}, ...cues]).join(' ')).toContain('focus mass');
});

test('a new operation may not focus a later matrix row; simultaneous comparisons and repeated cues remain valid', () => {
  const matrix: MaterialTeaching = {...forces, templateId:'visual-matrix', content:{columns:['甲','乙'], rows:[{label:'第一行',values:[1,2]},{label:'第二行',values:[3,4]}],unit:'',max:4}};
  expect(materialTeachingFocusTargets(matrix).map(x => x.id)).toEqual(['cell-1-1','cell-1-2','cell-2-1','cell-2-2']);
  expect(materialTeachingCueIssues(matrix, [{targetIds:['row-1','cell-1-1','cell-1-2']},{targetIds:['row-1','cell-1-2']},{targetIds:['row-2','cell-2-1']}])).toEqual([]);
  expect(materialTeachingCueIssues(matrix, [{targetIds:['row-1','cell-2-1']},{targetIds:['row-2']}]).join(' ')).toContain('focus cell-2-1');
});

test('overview and unbound old operation cues never fabricate a semantic target', () => {
  expect(sampleMaterialTeachingTimeline(forces, intervals, -1).focusTargets?.some(x => x.focus > 0)).toBe(false);
  const legacy = sampleMaterialTeachingTimeline(forces, [{targetIds:['forces'],startTick:0,durationTicks:96_000}], 90_000);
  expect(legacy.items[0]?.focus).toBe(1);
  expect(legacy.focusTargets?.some(x => x.focus > 0)).toBe(false);
});

test('new short focus aliases cannot reinterpret old whole display or sibling figure IDs', () => {
  const namedMass = {...forces,id:'mass'};
  const cues = materialTeachingSteps(namedMass).map(step => ({targetIds:[step.id]}));
  expect(materialTeachingCueIssues(namedMass,[{targetIds:['mass']},...cues])).toEqual([]);
  expect(resolveParagraphCue(namedMass,{targetIds:['mass']})?.targetIds).toEqual(['whole']);
  expect(materialTeachingCueIssues(namedMass,[{targetIds:['forces',materialTeachingFocusTarget('mass','mass')]},...cues.slice(1)])).toEqual([]);
  const stage = {type:'stage',id:'stage',layout:'main+rail',figures:[forces,{type:'callout',id:'mass',body:'质量保持不变。'}]};
  const nestedCues = cues.map(cue => ({targetIds:cue.targetIds.map(id => materialTeachingTarget(forces.id,id))}));
  expect(materialTeachingTreeIssues(stage,[...nestedCues,{targetIds:['mass']}])).toEqual([]);
  expect(materialTeachingTreeIssues(stage,[{targetIds:[materialTeachingTarget(forces.id,'forces'),focus('velocity')]},...nestedCues.slice(1)]).join(' ')).toContain('focus velocity');
});
