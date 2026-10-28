import { createPluginWorker } from './runtime';
import type { DesktopPluginNativeServices } from '../../../../packages/plugin-sdk/src/cordis';
import type { DesktopPluginProcess, DesktopPluginProcessConfiguration } from './manager';

/** Trusted native extensions share Electron main; optional workers remain isolated. */
export function createHostPluginProcess(config: DesktopPluginProcessConfiguration, native: DesktopPluginNativeServices, disposeNative: () => void): DesktopPluginProcess {
  const messages = new Set<(message: unknown) => void>();
  let receive: (message: unknown) => void = () => {};
  let closed = false;
  const runtime = createPluginWorker(config, {
    listen: listener => { receive = listener; },
    send: message => { if (!closed) for (const listener of messages) listener(message); },
  }, native);
  return {
    send(message) { if (closed) throw Error('Native plugin is closed'); queueMicrotask(() => { if (!closed) receive(message); }); },
    onMessage(listener) { messages.add(listener); return () => { messages.delete(listener); }; },
    onExit() { return () => {}; },
    async kill() {
      if (closed) return;
      closed = true;
      disposeNative();
      await runtime.close();
      messages.clear();
    },
  };
}
