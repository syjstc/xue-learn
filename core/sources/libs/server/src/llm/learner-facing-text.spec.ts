import {stripInternalLearningTargetRefs} from './learner-facing-text.js';

test('keeps ordinary 的 following a Latin teaching term', () => {
  const source = '为输入 token 建立模型状态和 KV 的那段计算。';
  expect(stripInternalLearningTargetRefs(source)).toBe(source);
});

test('removes only internal target references and their adjacent possessive', () => {
  expect(stripInternalLearningTargetRefs('解释 lt_1 的条件，保留 KV 的含义。')).toBe('解释 条件，保留 KV 的含义。');
  expect(stripInternalLearningTargetRefs('核对 lt_1 和 lt_2 的条件。')).toBe('核对 条件。');
  expect(stripInternalLearningTargetRefs('核对 lt_1 和 lt_2。')).toBe('核对。');
});
