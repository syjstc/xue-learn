import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isLearningRoute} from './navigation.mjs';

/** Plugin preferences are separate from Core's authoritative learner database. */
export class StateStore {
  #state;
  #writes = Promise.resolve();
  constructor(directory) { this.directory = directory; }
  async read() {
    if (this.#state) return structuredClone(this.#state);
    try {
      const state = JSON.parse(await readFile(join(this.directory, 'plugin-state.json'), 'utf8'));
      if (state.schemaVersion !== 1) throw Error('Unsupported XueLearn plugin preference version');
      this.#state = state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#state = {schemaVersion: 1};
    }
    return structuredClone(this.#state);
  }
  async update(change) {
    const write = this.#writes.then(async () => {
      const next = {...await this.read(), ...change, schemaVersion: 1};
      await mkdir(this.directory, {recursive: true, mode: 0o700});
      const temporary = join(this.directory, `.preferences-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(next, null, 2), {mode: 0o600});
      await rename(temporary, join(this.directory, 'plugin-state.json'));
      this.#state = next;
      return structuredClone(next);
    });
    this.#writes = write.catch(() => {});
    return write;
  }
}

export function parsePosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Learning position must be an object');
  const result = {};
  if (value.route !== undefined) {
    if (!isLearningRoute(value.route)) throw Error('Invalid learning route');
    result.route = value.route;
  }
  for (const key of ['goalId', 'unitId', 'sectionId']) {
    if (value[key] !== undefined) {
      const pattern = key === 'sectionId' ? /^[A-Za-z0-9_:-]{1,200}$/ : /^[A-Za-z0-9_-]{1,160}$/;
      if (typeof value[key] !== 'string' || !pattern.test(value[key])) throw Error(`Invalid ${key}`);
      result[key] = value[key];
    }
  }
  if (value.tab !== undefined) {
    if (!['reading', 'display', 'practice'].includes(value.tab)) throw Error('Invalid learning tab');
    result.tab = value.tab;
  }
  return result;
}
