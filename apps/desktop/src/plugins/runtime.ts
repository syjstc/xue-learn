import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Context, type Fiber, type Plugin } from 'cordis';
import { parseDesktopPluginManifest, type HostToPluginMessage, type PluginToHostMessage, type PluginRequest } from '../../../../packages/plugin-sdk/src/index';
import type { DesktopPluginCommand, DesktopPluginConfiguration, DesktopPluginService, DesktopPluginNativeServices } from '../../../../packages/plugin-sdk/src/cordis';

type Transport = { send(message: PluginToHostMessage): void; listen(listener: (message: unknown) => void): void };
/** One Cordis context per process: an extension cannot mutate another extension's services. */
export function createPluginWorker(configuration: DesktopPluginConfiguration & { entry: string }, transport: Transport, native?: DesktopPluginNativeServices) {
  const manifest = parseDesktopPluginManifest(configuration.manifest);
  const commands = new Map<string, DesktopPluginCommand>();
  const guards = new Set<() => void | Promise<void>>();
  const invocations = new Set<string>();
  const pending = new Map<string, { invocationId: string; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const context = new Context();
  let fiber: Fiber | undefined;
  let stopping = false;
  let disposal: Promise<null> | undefined;
  const desktop: DesktopPluginService = {
    ...(native ? { native } : {}),
    registerCommand(id, handler) {
      if (!manifest.contributes.commands.some(command => command.id === id)) throw Error(`Undeclared plugin command: ${id}`);
      if (commands.has(id) || typeof handler !== 'function') throw Error(`Invalid or duplicate plugin command: ${id}`);
      commands.set(id, handler);
      return () => { if (commands.get(id) === handler) commands.delete(id); };
    },
    beforeDeactivate(check) {
      if (typeof check !== 'function') throw Error('Expected a deactivation check');
      guards.add(check);
      return () => { guards.delete(check); };
    },
  };
  context.provide('desktop', desktop);
  const failPending = (invocationId: string) => {
    for (const [id, request] of pending) if (request.invocationId === invocationId) {
      clearTimeout(request.timer); pending.delete(id); request.reject(Error('Plugin command has ended'));
    }
  };
  async function request(message: PluginRequest): Promise<unknown> {
    if (message.method === 'activate') {
      if (fiber || stopping) throw Error('Plugin is already activated');
      const imported = await import(pathToFileURL(configuration.entry).href);
      const exported = imported.default ?? imported;
      const plugin = (exported.apply ? exported : exported.default ?? exported) as Plugin<DesktopPluginConfiguration>;
      fiber = await context.plugin(plugin, configuration);
      if (fiber.state !== 2) throw Error('Cordis plugin did not activate; check declared service dependencies');
      const missing = manifest.contributes.commands.filter(command => !commands.has(command.id));
      if (missing.length) throw Error(`Plugin did not register commands: ${missing.map(command => command.id).join(', ')}`);
      return { framework: 'cordis', apiVersion: 1 };
    }
    if (message.method === 'dispose') {
      if (disposal) return disposal;
      if (invocations.size) throw Error('Plugin commands are still running');
      stopping = true;
      disposal = (async () => {
        // Let the cached promise assignment complete before a synchronous guard can reject.
        await Promise.resolve();
        try {
          for (const guard of guards) await guard();
        } catch (error) { stopping = false; disposal = undefined; throw error; }
        await context.fiber.dispose();
        fiber = undefined; commands.clear(); guards.clear();
        return null;
      })();
      // Preserve a completed teardown so a host retry after its acknowledgement
      // timed out can safely receive success without replaying cleanup effects.
      return disposal;
    }
    if (message.method !== 'execute') throw Error('Unknown plugin request');
    if (!fiber || stopping) throw Error('Plugin is not active');
    const { command, workspaceId, args } = message.payload ?? {};
    if (typeof workspaceId !== 'string' || !workspaceId) throw Error('Plugin command requires a workspace');
    const handler = typeof command === 'string' ? commands.get(command) : undefined;
    if (!handler) throw Error('Unknown plugin command');
    if (invocations.size >= 4) throw Error('Plugin command concurrency limit reached');
    invocations.add(message.requestId);
    try {
      return await handler(args, Object.freeze({ workspaceId, call: (capability: string, method: string, args?: unknown) => {
        if (!invocations.has(message.requestId)) return Promise.reject(Error('Plugin command has ended'));
        if (!Object.hasOwn(manifest.requires, capability)) return Promise.reject(Error(`Undeclared host capability: ${capability}`));
        const requestId = randomUUID();
        return new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => { pending.delete(requestId); reject(Error('Host capability request timed out')); }, 30_000);
          pending.set(requestId, { invocationId: message.requestId, resolve, reject, timer });
          try { transport.send({ type: 'capability', requestId, invocationId: message.requestId, capability, method, args }); }
          catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
        });
      } }));
    } finally { invocations.delete(message.requestId); failPending(message.requestId); }
  }
  transport.listen(raw => {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as HostToPluginMessage;
    if (message.type === 'capability-result') {
      const call = pending.get(message.requestId);
      if (!call) return;
      pending.delete(message.requestId); clearTimeout(call.timer);
      if (message.ok) call.resolve(message.result); else call.reject(Error(message.error ?? 'Host capability failed'));
    } else if (message.type === 'request' && typeof message.requestId === 'string') {
      void request(message).then(
        result => transport.send({ type: 'response', requestId: message.requestId, ok: true, result }),
        error => transport.send({ type: 'response', requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    }
  });
  return { close: async () => { stopping = true; for (const id of invocations) failPending(id); await context.fiber.dispose(); commands.clear(); guards.clear(); } };
}
