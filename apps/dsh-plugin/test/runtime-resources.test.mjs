import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageRuntimeResources} from '../scripts/runtime-resources.mjs';

test('standalone package stages teaching skills without bundled fonts', async t => {
  const output = await mkdtemp(join(tmpdir(), 'xuelearn-runtime-resources-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  stageRuntimeResources({
    coreRoot: fileURLToPath(new URL('../../../core', import.meta.url)),
    output,
  });
  // Runtime loads the teaching skills from the packaged directory.
  for (const skill of ['general-teaching', 'language-learning', 'coding-by-building', 'mathematics']) {
    assert.match(await readFile(join(output, 'teaching-skills/builtin', skill, 'SKILL.md'), 'utf8'), /\S/);
    assert.equal(typeof JSON.parse(await readFile(join(output, 'teaching-skills/builtin', skill, 'xuelearn.json'), 'utf8')), 'object');
  }
  assert.equal((await readdir(output)).includes('fonts'), false);
});
