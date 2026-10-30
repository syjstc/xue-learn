import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import path from 'node:path';

/** Read an explicitly staged, local, section-bound one-character correction. */
export async function readStagedSectionPunctuation(input: {imageStorageDir: string; unitId: string; sectionId: string}) {
  if (![input.unitId, input.sectionId].every((value) => /^[A-Za-z0-9_-]+$/.test(value)))
    throw new Error('Invalid staged section identity');
  const file = path.join(input.imageStorageDir, input.unitId, 'guided-repair-candidates', `section-${input.sectionId}.json`);
  let handle;
  try { handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 4096) throw new Error('Invalid staged section correction file');
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size) throw new Error('Staged section correction changed during reading');
    const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    const keys = ['version', 'unitId', 'sectionId', 'textSha256', 'punctuationIndex'];
    if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key)) || value.version !== 1 ||
      value.unitId !== input.unitId || value.sectionId !== input.sectionId ||
      typeof value.textSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.textSha256) ||
      typeof value.punctuationIndex !== 'number' || !Number.isSafeInteger(value.punctuationIndex))
      throw new Error('Staged section correction does not match the current section');
    return {textSha256: value.textSha256, punctuationIndex: value.punctuationIndex};
  } finally { await handle.close(); }
}
