import {watch} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = path.join(root, 'core');
const desktop = path.join(root, 'desktop');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

// Start only after the current Core has passed its build and workspace check.
const check = spawnSync(pnpm, ['--dir', 'desktop', 'run', 'check:core'], {cwd: root, stdio: 'inherit'});
if (check.error) throw check.error;
if (check.status !== 0) process.exit(check.status ?? 1);

let stopping = false;
let pending = false;
let building = false;
let buildChild;
let debounce;
let requestedSignal;
const watchers = [];

function rebuild() {
  if (stopping || building || !pending) return;
  pending = false;
  building = true;
  buildChild = spawn(pnpm, ['--dir', 'core', 'run', 'build'], {cwd: root, stdio: 'inherit'});
  buildChild.on('error', error => {
    console.error(`[core] Could not rebuild: ${error.message}`);
  });
  buildChild.on('close', code => {
    buildChild = undefined;
    building = false;
    if (!stopping && code !== 0) console.error('[core] Rebuild failed; the next source change will retry.');
    if (pending) scheduleBuild();
  });
}

function scheduleBuild() {
  if (stopping) return;
  pending = true;
  clearTimeout(debounce);
  debounce = setTimeout(rebuild, 300);
}

for (const directory of ['sources', 'resources', 'scripts']) {
  watchers.push(watch(path.join(core, directory), {recursive: true}, scheduleBuild));
}
watchers.push(watch(core, (_event, filename) => {
  if (filename === 'package.json') scheduleBuild();
}));

const desktopChild = spawn(process.execPath, ['scripts/desktop-dev.mjs'], {
  cwd: desktop,
  env: process.env,
  stdio: 'inherit',
});

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  clearTimeout(debounce);
  for (const watcher of watchers) watcher.close();
  buildChild?.kill(signal);
  desktopChild.kill(signal);
}

process.on('SIGINT', () => { requestedSignal = 'SIGINT'; stop('SIGINT'); });
process.on('SIGTERM', () => { requestedSignal = 'SIGTERM'; stop('SIGTERM'); });
desktopChild.on('error', error => {
  console.error(`[desktop] Could not start: ${error.message}`);
  stop();
  process.exitCode = 1;
});
desktopChild.on('close', code => {
  stop();
  process.exitCode = requestedSignal ? 0 : code ?? 1;
});
