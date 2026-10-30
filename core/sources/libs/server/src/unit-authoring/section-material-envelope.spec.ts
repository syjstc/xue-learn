import {z} from 'zod';
import {analyzeFormula, matchFormulaTrees} from '../../../formula-analysis/src/index.js';
import {materialGenerationJitItemSchema} from '../llm/jit-structured-items.js';
import {parseFlattenedMaterialItems} from './section-material-envelope.js';
import {splitSpokenParagraphBeats} from '../llm/narrated-material-sequence.js';
import {createHash} from 'node:crypto';

test('accepted Display derivations survive the section envelope without reauthoring renderer node references', () => {
  const before = analyzeFormula('x + 1'), after = analyzeFormula('y^2');
  const correspondence = matchFormulaTrees(before, after);
  const items = [{kind: 'block', block: {type: 'display', id: 'proof', title: '比较两条更新规则', document: {
    version: 1, id: 'proof', plugins: [{id: 'org.xuelearn.math', version: '1.0.0'}],
    root: {id: 'proof', kind: 'math:derivation', version: 1, payload: {
      document: {title: '比较两条更新规则'}, derived: {steps: [{before, after, transitions: [{correspondence}]}]},
    }},
  }}}];
  expect(parseFlattenedMaterialItems(items, z.array(materialGenerationJitItemSchema), true)).toEqual(items);
  items[0]!.block.document.root.payload.document.title = '参见 lt_1';
  expect(() => parseFlattenedMaterialItems(items, z.array(materialGenerationJitItemSchema), true)).toThrow('Learner-facing text');
});

const paragraph = (text: string, cue: Record<string, unknown> = {target: 'whole', targetIds: ['board']}) =>
  ({kind: 'block', block: {type: 'paragraph', text, cue}});
const limited = (max: number) => z.array(materialGenerationJitItemSchema).max(max);
const joined = (items: any[]) => items.map((item) => item.block.text).join('').replace(/\s/gu, '');

test('reflows adjacent identical board cues at sentence boundaries without dropping words', () => {
  const original = [paragraph('第一句。第二句。'), paragraph('第三句。第四句。'), paragraph('第五句。第六句。')];
  const result = parseFlattenedMaterialItems(original, limited(2), true) as any[];
  expect(result).toHaveLength(2);
  expect(joined(result)).toBe(joined(original));
  expect(result.every((item) => item.block.cue.targetIds[0] === 'board')).toBe(true);
  expect(result.every((item) => splitSpokenParagraphBeats(item.block.text).length === 1)).toBe(true);
});

test('does not reflow different cues or action cues to evade a budget', () => {
  expect(() => parseFlattenedMaterialItems([
    paragraph('第一句。第二句。'), paragraph('第三句。第四句。', {target: 'whole', targetIds: ['other']}),
  ], limited(1), true)).toThrow('invalid section envelope');
  expect(() => parseFlattenedMaterialItems([
    paragraph('第一句。第二句。', {target: 'whole', targetIds: ['board'], op: 'highlight'}),
    paragraph('第三句。第四句。', {target: 'whole', targetIds: ['board'], op: 'highlight'}),
  ], limited(1), true)).toThrow('invalid section envelope');
});

test('leaves guided-image narration and its beat boundaries frozen', () => {
  const heading = {kind: 'block', block: {type: 'heading', level: 2, text: '图示'}};
  const image = {kind: 'block', block: {type: 'illustration', guidedImage: {}}};
  const input = [heading, image, paragraph('第一句。第二句。'), paragraph('第三句。第四句。')];
  expect(() => parseFlattenedMaterialItems(input, z.array(z.unknown()).max(3) as any, true)).toThrow('invalid section envelope');
});

test('a staged correction changes only the specified period and is refused for a mismatched or invalid target', () => {
  const one = '第一句。第二句。';
  const before = [paragraph(one), paragraph('第三句。第四句。')];
  const repair = {textSha256: createHash('sha256').update(one).digest('hex'), punctuationIndex: one.indexOf('。')};
  const result = parseFlattenedMaterialItems(before, limited(1), true, repair) as any[];
  expect(joined(result)).toBe(joined(before).replace('第一句。第二句', '第一句；第二句'));
  expect(() => parseFlattenedMaterialItems(before, limited(1), true, {...repair, textSha256: '0'.repeat(64)})).toThrow('exactly one');
  expect(() => parseFlattenedMaterialItems(before, limited(1), true, {...repair, punctuationIndex: 0})).toThrow('punctuation position');
});

test('does not use reflow to hide another validation error', () => {
  const invalid = [paragraph('第一句。第二句。'), paragraph('第三句。第四句。'), paragraph('参见 lt_1。')];
  expect(() => parseFlattenedMaterialItems(invalid, limited(1), true)).toThrow();
});
