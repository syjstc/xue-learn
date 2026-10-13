import { utilityProcess, type UtilityProcess } from 'electron';
import type { DesktopPluginProcess, DesktopPluginProcessConfiguration } from './manager';

/** Do not inherit credentials or Node loader flags into installed extension code. */
export function pluginEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (source[key]) result[key] = source[key]!;
  }
  return result;
}

/** Wait for the OS process, escalating only while Electron still identifies this live child. */
export function terminatePluginProcess(
  child: UtilityProcess,
  options: { gracefulMs?: number; forceMs?: number; forceKill?: (pid: number) => void } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    let exited = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(escalation); clearTimeout(deadline);
      child.removeListener('exit', onExit);
    };
    const onExit = () => { exited = true; cleanup(); resolve(); };
    child.once('exit', onExit);
    try { child.kill(); } catch (error) { cleanup(); reject(error); return; }
    if (exited) return;
    escalation = setTimeout(() => {
      if (exited) return;
      // Electron clears pid after exit; do not signal a stale PID remembered at launch.
      const pid = child.pid;
      if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0 || child.pid !== pid) {
        cleanup(); reject(Error('Plugin process did not exit and has no live process identifier')); return;
      }
      try { (options.forceKill ?? (id => { process.kill(id, 'SIGKILL'); }))(pid); }
      catch (error) {
        // An ESRCH race means the exit notification can still be in flight.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') { cleanup(); reject(error); return; }
      }
      if (exited) return;
      deadline = setTimeout(() => { cleanup(); reject(Error('Plugin process did not exit after forced termination')); }, options.forceMs ?? 1500);
    }, options.gracefulMs ?? 1000);
  });
}

export function createElectronPluginProcess(workerEntry: string, config: DesktopPluginProcessConfiguration): DesktopPluginProcess {
  const child = utilityProcess.fork(workerEntry, [JSON.stringify(config)], {
    cwd: config.pluginRoot,
    env: pluginEnvironment(process.env),
    serviceName: `XueLearn Plugin: ${config.pluginId}`,
    stdio: 'pipe',
  });
  // Keep plugin output out of host logs; drain both pipes to avoid deadlocking a worker.
  child.stdout?.resume(); child.stderr?.resume();
  let exited = false;
  let termination: Promise<void> | undefined;
  child.once('exit', () => { exited = true; });
  return {
    send: message => child.postMessage(message),
    onMessage(listener) { child.on('message', listener); return () => { child.removeListener('message', listener); }; },
    onExit(listener) { child.on('exit', listener); return () => { child.removeListener('exit', listener); }; },
    kill() {
      if (exited) return Promise.resolve();
      if (!termination) termination = terminatePluginProcess(child).catch(error => { termination = undefined; throw error; });
      return termination;
    },
  };
}
