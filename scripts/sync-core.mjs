import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = path.join(root, 'core');
const desktop = path.join(root, 'desktop');
const corePackage = JSON.parse(fs.readFileSync(path.join(core, 'package.json'), 'utf8'));
const pinned = JSON.parse(fs.readFileSync(path.join(desktop, 'core-dependency.v1.json'), 'utf8'));

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) throw new Error(`Invalid Core version: ${version}`);
  return {numbers: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? []};
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return Math.sign(a.numbers[index] - b.numbers[index]);
  }
  if (!a.prerelease.length || !b.prerelease.length) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let index = 0; index < Math.min(a.prerelease.length, b.prerelease.length); index++) {
    const aPart = a.prerelease[index], bPart = b.prerelease[index];
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart), bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) return Math.sign(Number(aPart) - Number(bPart));
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }
  return Math.sign(a.prerelease.length - b.prerelease.length);
}

if (compareVersions(corePackage.version, pinned.version) < 0) {
  throw new Error(`Core ${corePackage.version} is older than Desktop's pin ${pinned.version}. Assign a new Core version first.`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {cwd, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'xue-learn-core-pack-'));
try {
  run('pnpm', ['pack', '--pack-destination', temporary], core);
  const archives = fs.readdirSync(temporary).filter(name => name.endsWith('.tgz'));
  if (archives.length !== 1) throw new Error(`Expected one Core archive, found ${archives.length}`);
  run('node', [path.join(desktop, 'scripts/pin-core-release.mjs'), path.join(temporary, archives[0])], desktop);
  run('pnpm', ['install', '--no-frozen-lockfile'], desktop);
  run('pnpm', ['run', 'check:core'], desktop);
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
