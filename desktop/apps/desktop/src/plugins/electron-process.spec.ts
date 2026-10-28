import { EventEmitter } from 'node:events';
import type { UtilityProcess } from 'electron';
jest.mock('electron', () => ({ utilityProcess: {} }));
import { terminatePluginProcess } from './electron-process';

class Child extends EventEmitter {
  pid: number | undefined = 43123;
  kill = jest.fn(() => true);
  exit(): void { this.pid = undefined; this.emit('exit', 0); }
}
describe('plugin process termination', () => {
  it('awaits graceful exit without escalating', async () => {
    const child = new Child();
    const forceKill = jest.fn();
    const stopping = terminatePluginProcess(child as unknown as UtilityProcess, { gracefulMs: 20, forceKill });
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.exit();
    await stopping;
    expect(forceKill).not.toHaveBeenCalled();
    expect(child.listenerCount('exit')).toBe(0);
  });
  it('escalates a signal-trapping child and waits for its actual exit', async () => {
    const child = new Child();
    const forceKill = jest.fn(() => { child.exit(); });
    await terminatePluginProcess(child as unknown as UtilityProcess, { gracefulMs: 5, forceMs: 20, forceKill });
    expect(forceKill).toHaveBeenCalledWith(43123);
    expect(child.listenerCount('exit')).toBe(0);
  });
  it('never sends a force signal using a stale launch PID', async () => {
    const child = new Child();
    const forceKill = jest.fn();
    const stopping = terminatePluginProcess(child as unknown as UtilityProcess, { gracefulMs: 5, forceKill });
    child.pid = undefined;
    await expect(stopping).rejects.toThrow('no live process identifier');
    expect(forceKill).not.toHaveBeenCalled();
  });
  it('rejects bounded termination failure instead of reporting a surviving process as disabled', async () => {
    const child = new Child();
    await expect(terminatePluginProcess(child as unknown as UtilityProcess, { gracefulMs: 5, forceMs: 5, forceKill: () => undefined })).rejects.toThrow('did not exit');
    expect(child.listenerCount('exit')).toBe(0);
  });
});
