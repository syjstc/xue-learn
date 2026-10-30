import {mkdtemp, mkdir, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readStagedSectionPunctuation} from './section-punctuation-repair.js';

test('staged punctuation is optional and strictly bound to the unit and section', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'section-repair-'));
  const input = {imageStorageDir: root, unitId: 'unit-1', sectionId: 'section-1'};
  expect(await readStagedSectionPunctuation(input)).toBeUndefined();
  const dir = path.join(root, 'unit-1', 'guided-repair-candidates');
  await mkdir(dir, {recursive: true});
  const file = path.join(dir, 'section-section-1.json');
  const value = {version: 1, unitId: 'unit-1', sectionId: 'section-1', textSha256: 'a'.repeat(64), punctuationIndex: 4};
  await writeFile(file, JSON.stringify(value));
  expect(await readStagedSectionPunctuation(input)).toEqual({textSha256: 'a'.repeat(64), punctuationIndex: 4});
  await writeFile(file, JSON.stringify({...value, sectionId: 'other'}));
  await expect(readStagedSectionPunctuation(input)).rejects.toThrow('does not match');
  await writeFile(file, JSON.stringify({...value, extra: true}));
  await expect(readStagedSectionPunctuation(input)).rejects.toThrow('does not match');
  const link = path.join(dir, 'section-link.json');
  await symlink(file, link);
  await expect(readStagedSectionPunctuation({...input, sectionId: 'link'})).rejects.toThrow();
});
