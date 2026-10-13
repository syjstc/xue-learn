import { createPluginWorker } from './runtime';
import type { DesktopPluginConfiguration } from '../../../../packages/plugin-sdk/src/cordis';
import type { PluginToHostMessage } from '../../../../packages/plugin-sdk/src/index';
export { createPluginWorker } from './runtime';
type Transport = { send(message: PluginToHostMessage): void; listen(listener: (message: unknown) => void): void };

// This entry also supports Node's IPC transport so integration tests run real isolated processes.
if (process.argv[2]) {
  const config = JSON.parse(process.argv[2]) as DesktopPluginConfiguration & { entry: string };
  const parentPort = (process as unknown as { parentPort?: { postMessage(value: unknown): void; on(event: string, listener: (event: { data: unknown }) => void): void } }).parentPort;
  const transport: Transport = parentPort
    ? { send: value => parentPort.postMessage(value), listen: listener => parentPort.on('message', event => listener(event.data)) }
    : { send: value => { process.send?.(value); }, listen: listener => { process.on('message', listener); } };
  createPluginWorker(config, transport);
}
