import {displayBuildRetryReason} from './retry.js';

test.each([
  ['fetch failed', 'connection'],
  ['Connection error.', 'connection'],
  ['terminated', 'connection'],
  ['Our servers are currently overloaded. Please try again later.', 'provider-busy'],
  ['Codex image generation failed (HTTP 503): unavailable', 'provider-busy'],
  ['Course display build failed: fetch failed; Connection error.', 'connection'],
  ['Course display build failed: Our servers are currently overloaded. Please try again later.; terminated', 'provider-busy'],
])('classifies an isolated transport failure: %s', (message, reason) => {
  expect(displayBuildRetryReason(message)).toBe(reason);
});

test.each([
  '配图仍未通过检查：缺少黑键；Our servers are currently overloaded. Please try again later.',
  'Course display build failed: fetch failed; Unknown target: step-3',
  'Course display build failed: cancelled',
  'Course display build failed: 展示输入已改变，请重新构建。',
  'Codex image generation failed (HTTP 401): login expired',
  'Codex image generation failed (HTTP 400): invalid input',
  'Invalid schema: fetch failed',
  '',
])('keeps substantive errors actionable: %s', message => {
  expect(displayBuildRetryReason(message)).toBeNull();
});
