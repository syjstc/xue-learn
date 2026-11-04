import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

/** Only operating-system/runtime settings cross the process boundary. */
export function workerEnvironment(source = process.env) {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ',
    'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PROGRAMDATA',
    'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'DSH_DESKTOP_NODE_EXECUTABLE'];
  return {...Object.fromEntries(names.filter(name => typeof source[name] === 'string').map(name => [name, source[name]])), ELECTRON_RUN_AS_NODE: '1'};
}

export class LearningRuntime {
  #child;
  #starting;
  #ready;
  #stopped = false;
  constructor({dataPath, models, forkProcess = fork, workerPath = fileURLToPath(new URL('../dist/runtime-worker.cjs', import.meta.url)), log = console}) {
    this.dataPath = dataPath; this.models = models; this.forkProcess = forkProcess;
    this.workerPath = workerPath; this.log = log;
    this.token = randomBytes(32).toString('hex');
  }
  get status() { return {ready: Boolean(this.#ready), dataPath: this.dataPath}; }
  async start() {
    if (this.#stopped) throw Error('XueLearn plugin has been disabled');
    if (this.#ready) return this.#ready;
    if (this.#starting) return this.#starting;
    const startup = new Promise((resolve, reject) => {
      const child = this.forkProcess(this.workerPath, [], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        execArgv: [], env: workerEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      this.#child = child;
      const timer = setTimeout(() => { reject(Error('Learning runtime did not start within 60 seconds')); child.kill(); }, 60_000);
      timer.unref?.();
      const send = message => { if (child.connected) child.send(message); };
      child.stdout?.on('data', data => this.log.info?.(`[XueLearn] ${data.toString().trim()}`));
      child.stderr?.on('data', data => this.log.warn?.(`[XueLearn] ${data.toString().trim()}`));
      child.on('message', message => {
        if (message?.type === 'xuelearn.dsh.ready') {
          if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) { reject(Error('Invalid learning runtime port')); child.kill(); return; }
          clearTimeout(timer);
          this.#ready = {port: message.port, endpoint: `http://127.0.0.1:${message.port}`};
          resolve(this.#ready);
        } else if (message?.type === 'xuelearn.dsh.llm.request') {
          void this.models.handle(message, send).catch(error => send({type: 'xuelearn.dsh.llm.error', id: message.id, error: error.message}));
        } else if (message?.type === 'xuelearn.dsh.llm.cancel') this.models.cancel(message.id);
        else if (message?.type === 'xuelearn.dsh.fatal' || message?.type === 'xuelearn.local.fatal') {
          clearTimeout(timer); reject(Error(message.message ?? 'Learning runtime failed')); child.kill();
        }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => {
        clearTimeout(timer); this.#ready = undefined; this.#starting = undefined; this.#child = undefined;
        void this.models.dispose();
        reject(Error(`Learning runtime exited (${signal ?? code})`));
      });
      send({type: 'xuelearn.dsh.start', dataPath: join(this.dataPath, 'workspace'), token: this.token, workspaceId: 'xuelearn-dsh-v1'});
    });
    this.#starting = startup;
    try { return await startup; }
    catch (error) { this.#starting = undefined; throw error; }
  }
  async request(path, {method = 'GET', body, signal, headers = {}} = {}) {
    assertLearningPath(path);
    const ready = await this.start();
    return fetch(ready.endpoint + path, {
      method, signal, redirect: 'error',
      headers: {...headers, authorization: `Bearer ${this.token}`},
      ...(body === undefined ? {} : {body, duplex: 'half'}),
    });
  }
  async stop() {
    this.#stopped = true; await this.models.dispose();
    const child = this.#child;
    if (!child) return;
    await new Promise(resolve => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 10_000);
      timeout.unref?.();
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      child.kill('SIGTERM');
    });
  }
}

const LEARNING_PREFIXES = [
  '/api/goals', '/api/units', '/api/projects', '/api/assessments', '/api/reviews', '/api/flashcards',
  '/api/generation', '/api/generation-runs', '/api/agenda', '/api/teaching-skills', '/api/rag',
  '/api/learning-spaces', '/api/learning-trajectory', '/api/agent/goal-creation-sessions',
  '/api/agent/threads', '/api/agent/foundation-goals', '/api/profile/learner', '/api/teaching-personas',
  '/api/memories', '/api/memory-candidates', '/api/cognition',
  '/api/local/display-workspace', '/api/local/display-plugins', '/api/local/display-builds',
];
const LEARNING_SETTINGS = new Set(['appearance', 'client-preferences', 'learning-view', 'memory', 'teaching-persona']);
const LEARNING_EXACT = new Set(['/api/agent/time', '/api/agent/goals/search', '/api/agent/activity/recent', '/api/profile/learning-state']);
export function assertLearningPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || /[\\\r\n#]/.test(path)) throw Error('Invalid learning API path');
  const parsed = new URL(path, 'http://127.0.0.1');
  if (parsed.pathname !== path.split('?')[0] || decodeURIComponent(parsed.pathname).includes('..')) throw Error('Invalid learning API path');
  if (LEARNING_EXACT.has(parsed.pathname)) return;
  if (LEARNING_SETTINGS.has(parsed.pathname.replace(/^\/api\/settings\//, ''))) return;
  if (!LEARNING_PREFIXES.some(prefix => parsed.pathname === prefix || parsed.pathname.startsWith(prefix + '/'))) throw Error('This API is not exposed by the learning plugin');
}
