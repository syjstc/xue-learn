import type {MaterialTeaching} from "./material-teaching.js";
import {materialTeachingSortOperations} from "./material-teaching-sort.js";

export type MaterialTeachingFocusTarget = Readonly<{id: string; label: string; operationIds: readonly string[]}>;
type Entry = readonly [id: string, label: string, operations: string];
const entries = (values: readonly Entry[]): MaterialTeachingFocusTarget[] => values.map(([id, label, operations]) => ({id, label, operationIds: operations.split(' ')}));

/** Address only renderer-owned evidence. These optional subtargets do not
 * advance an operation or change accepted content, timing, or geometry. */
export function materialTeachingFocusTargets(block: MaterialTeaching): MaterialTeachingFocusTarget[] {
  switch (block.templateId) {
    case 'general-question': return entries([
      ...block.content.objects.map((label, i): Entry => [`object-${i + 1}`, label, 'observe compare']),
      ...block.content.observations.map((label, i): Entry => [`observation-${i + 1}`, label, 'observe compare']),
      ['question', block.content.question, 'observe compare'], ['learning-goal', block.content.goal, 'goal'],
    ]);
    case 'general-layers': return entries(block.content.layers.flatMap((x, i): Entry[] => [[`layer-title-${i + 1}`, x.title, `layer-${i + 1}`], [`layer-detail-${i + 1}`, x.detail, `layer-${i + 1}`]]));
    case 'general-flow': return entries(block.content.nodes.map((label, i): Entry => [`node-label-${i + 1}`, label, `node-${i + 1}`]));
    case 'general-compare': return entries(block.content.metrics.flatMap((x, i) => x.values.map((v, j): Entry => [`value-${i + 1}-${j + 1}`, `${x.label} / ${block.content.names[j]}: ${v}${x.unit}`, `metric-${i + 1}`])));
    case 'general-summary': return entries([['center', block.content.center, 'concept-1 concept-2 concept-3'], ...block.content.concepts.map((label, i): Entry => [`concept-${i + 1}-detail`, label, `concept-${i + 1}`]), ['transfer-detail', block.content.transfer, 'transfer']]);
    case 'math-pythagoras': return entries([['triangle', '同一个直角三角形', 'areas rearrange'], ['square-a', 'a 边正方形', 'areas identity'], ['square-b', 'b 边正方形', 'areas identity'], ['square-c', 'c 边正方形', 'areas identity'], ['area-identity', '面积恒等式', 'identity']]);
    case 'math-tangent': return entries([['point-a', '固定取样点', 'secant approach'], ['point-b', '移动取样点', 'secant approach'], ['secant-line', '割线', 'secant approach'], ['tangent-line', '切线', 'tangent'], ['slope', '斜率', 'secant approach tangent']]);
    case 'math-integral': return entries([['interval-axis', '累积区间', 'interval'], ['rectangles', '近似矩形', 'partition refine'], ['lower-sum', '下和', 'partition refine'], ['upper-sum', '上和', 'partition refine'], ['exact-area', '精确积分', 'integral']]);
    case 'math-probability': return entries([['samples', '完整样本', 'inventory'], ['selected-samples', block.content.conditionName, 'condition'], ['intersection', '交集', 'condition ratio'], ['conditional-total', '条件样本数 / 新分母', 'condition ratio'], ['probability', '条件概率', 'condition ratio']]);
    case 'physics-forces': return entries([['mass', '质量', 'forces'], ['applied-force', '推力', 'forces'], ['friction', '摩擦力', 'forces'], ['normal-force', '支持力', 'forces'], ['weight', '重力', 'forces'], ['net-force', '合力', 'resultant quantities'], ['acceleration', '加速度', 'motion quantities'], ['velocity', '速度', 'motion quantities'], ['displacement', '位移', 'motion quantities']]);
    case 'physics-waves': return entries([['wave-1', '第一列分量波', 'components compare'], ['wave-2', '第二列分量波', 'components compare'], ['combined-wave', '合成波', 'superpose propagate compare'], ['phase', '相位关系', 'compare']]);
    case 'physics-circuit': return entries([['source', '电源', 'circuit quantities'], ['resistor-1', '第一个电阻', 'circuit quantities'], ['resistor-2', '第二个电阻', 'circuit quantities'], ['current-flow', '电流路径', 'current'], ['equivalent-resistance', '等效电阻', 'quantities'], ['total-current', '总电流', 'quantities']]);
    case 'chemistry-reaction': return entries([...block.content.reactants.flatMap(x => x.atoms.map((a): Entry => [`atom-${a.id}`, `${a.element} (${a.id})`, 'atoms rearrange conservation'])), ['old-bonds', '原有化学键', 'break-bonds'], ['new-bonds', '产物化学键', 'form-bonds'], ['equation', '化学方程式', 'conservation']]);
    case 'chemistry-titration': return entries([['apparatus', '滴定装置', 'before-equivalence'], ['ph-curve', 'pH 曲线', 'before-equivalence equivalence excess'], ['equivalence-point', '等当点', 'before-equivalence equivalence excess'], ['measurement', '滴定读数', 'before-equivalence equivalence excess']]);
    case 'biology-mitosis': return entries([...Array.from({length: block.content.chromosomeCount}, (_, i): Entry => [`chromosome-${i + 1}`, `染色体 ${i + 1}`, 'alignment separation']), ['daughter-left', '左侧子细胞', 'division'], ['daughter-right', '右侧子细胞', 'division']]);
    case 'biology-enzyme': return entries([['enzyme', block.content.enzyme, 'recognition binding'], ['substrate', block.content.substrate, 'recognition binding'], ['active-site', '活性位点', 'recognition binding'], ['products', block.content.products.join('、'), 'reaction release']]);
    case 'geography-water': return entries(block.content.nodes.map((n, i): Entry => [`node-${i + 1}`, n.label, `path-${i + 1} path-${i === 0 ? 5 : i}`]));
    case 'history-timeline': return entries([...block.content.events.map((e, i): Entry => [`event-${i + 1}-detail`, e.evidence, `event-${i + 1}`]), ['historical-evidence', block.content.caution, 'evidence']]);
    case 'language-syntax': return entries([['subject', block.content.subject, 'sentence parse verb relation'], ['predicate', block.content.verb, 'sentence parse verb relation'], ['object', block.content.object, 'sentence parse verb relation']]);
    case 'language-perspective': return entries([['event-detail', block.content.object, 'event'], ['inner-account', block.content.firstPerson, 'first-person'], ['external-account', block.content.observer, 'observer']]);
    case 'cs-recursion': return entries(Array.from({length: block.content.start}, (_, i): Entry => [`frame-${i + 1}`, `f(${i + 1})`, `call-${i + 1} return-${i + 1}`]));
    case 'cs-sorting': {
      const operations = materialTeachingSortOperations(block.content.values);
      return block.content.values.map((value, i) => ({id: `value-${i + 1}`, label: `${value} (原序号 ${i + 1})`, operationIds: operations.filter(op => op.sourceItemIds.includes(`value-${i + 1}`)).map(op => op.id)}));
    }
    // Music operations already address exact saved note groups.
    case 'music-score': case 'music-harmony': return [];
    case 'economics-equilibrium': return entries([['supply-curve', '供给曲线', 'curves'], ['demand-curve', '需求曲线', 'curves'], ['original-equilibrium', '原有均衡', 'equilibrium'], ['shifted-demand', '变化后的需求', 'shift'], ['new-equilibrium', '新均衡', 'shift']]);
    case 'visual-balance': return entries(['left', 'right'].flatMap(side => block.content[side as 'left' | 'right'].items.map((x, i): Entry => [`${side}-item-${i + 1}`, x.label, `${side} difference`])));
    case 'visual-matrix': return entries(block.content.rows.flatMap((r, i) => r.values.map((v, j): Entry => [`cell-${i + 1}-${j + 1}`, `${r.label} / ${block.content.columns[j]}: ${v}${block.content.unit}`, `row-${i + 1}`])));
    case 'visual-network': return entries(block.content.nodes.map((n, i): Entry => [`node-${i + 1}`, n.label, ['nodes', ...block.content.links.flatMap((l, j) => l.from === n.id || l.to === n.id ? [`link-${j + 1}`] : [])].join(' ')]));
    case 'visual-hierarchy': return entries(block.content.groups.flatMap((g, i) => g.members.map((label, j): Entry => [`member-${i + 1}-${j + 1}`, label, `group-${i + 1}`])));
    case 'visual-ranking': return entries(block.content.items.map((x, i): Entry => [`item-${i + 1}`, x.label, 'before change after']));
    default: return [];
  }
}

export const materialTeachingFocusTarget = (figureId: string, id: string) => `teaching:${figureId}:focus:${id}`;
export function materialTeachingFocusId(block: MaterialTeaching, target: string, allowUnscoped = true): string | undefined {
  // An existing whole-display ID wins over a newly added convenience alias.
  // Nested figures only expose canonical focus IDs in their shared catalog.
  return materialTeachingFocusTargets(block).find(item => allowUnscoped && target !== block.id && target === item.id || target === materialTeachingFocusTarget(block.id, item.id))?.id;
}

/** Before content exists the model needs the same addressing grammar as the
 * concrete catalog above. Each parenthesis names valid operation IDs. */
export const MATERIAL_TEACHING_FOCUS_RULES: Readonly<Record<string, string>> = {
  'general-question': 'object-1/2、observation-1/2、question (observe/compare)；learning-goal (goal)',
  'general-layers': 'layer-title-N、layer-detail-N (layer-N)',
  'general-flow': 'node-label-N (node-N)',
  'general-compare': 'value-N-1、value-N-2 分别指两侧第N个指标 (metric-N)',
  'general-summary': 'center (concept-1/2/3)；concept-N-detail (concept-N)；transfer-detail (transfer)',
  'math-pythagoras': 'triangle (areas/rearrange)；square-a、square-b、square-c (areas/identity)；area-identity (identity)',
  'math-tangent': 'point-a、point-b、secant-line (secant/approach)；tangent-line (tangent)；slope (secant/approach/tangent)',
  'math-integral': 'interval-axis (interval)；rectangles、lower-sum、upper-sum (partition/refine)；exact-area (integral)',
  'math-probability': 'samples (inventory)；selected-samples (condition)；intersection、conditional-total、probability (condition/ratio)',
  'physics-forces': 'mass、applied-force、friction、normal-force、weight (forces)；net-force (resultant/quantities)；acceleration、velocity、displacement (motion/quantities)',
  'physics-waves': 'wave-1、wave-2 (components/compare)；combined-wave (superpose/propagate/compare)；phase (compare)',
  'physics-circuit': 'source、resistor-1、resistor-2 (circuit/quantities)；current-flow (current)；equivalent-resistance、total-current (quantities)',
  'chemistry-reaction': 'atom-<原有atom.id> (atoms/rearrange/conservation)；old-bonds (break-bonds)；new-bonds (form-bonds)；equation (conservation)',
  'chemistry-titration': 'apparatus (before-equivalence)；ph-curve、equivalence-point、measurement (before-equivalence/equivalence/excess)',
  'biology-mitosis': 'chromosome-N (alignment/separation)；daughter-left、daughter-right (division)',
  'biology-enzyme': 'enzyme、substrate、active-site (recognition/binding)；products (reaction/release)',
  'geography-water': 'node-N (相邻的path-N、path-(N-1)，node-1与path-5相邻)',
  'history-timeline': 'event-N-detail (event-N)；historical-evidence (evidence)',
  'language-syntax': 'subject、predicate、object (sentence/parse/verb/relation)',
  'language-perspective': 'event-detail (event)；inner-account (first-person)；external-account (observer)',
  'cs-sorting': 'value-N 按原始数组身份指向单个值 (values/sorted，以及实际涉及该原始值的compare-N或swap-N)',
  'cs-recursion': 'frame-N (call-N/return-N)',
  'economics-equilibrium': 'supply-curve、demand-curve (curves)；original-equilibrium (equilibrium)；shifted-demand、new-equilibrium (shift)',
  'visual-balance': 'left-item-N (left/difference)；right-item-N (right/difference)',
  'visual-matrix': 'cell-N-M 第N行第M列 (row-N)',
  'visual-network': 'node-N 按nodes顺序 (nodes，以及与该节点实际相连的link-N)',
  'visual-hierarchy': 'member-N-M 第N组第M个成员 (group-N)',
  'visual-ranking': 'item-N 按原始items顺序 (before/change/after)',
};
