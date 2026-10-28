import { Context } from 'cordis';
import type { DesktopPluginCapabilityContext, DesktopPluginCapabilityHost } from './manager';

export type HostCapabilityMethods = Record<string, (args: unknown, context: DesktopPluginCapabilityContext) => Promise<unknown>>;
/** Built-in adapters use Cordis too; their implementation is hidden behind versioned methods. */
export class DesktopHostCapabilities implements DesktopPluginCapabilityHost {
  private readonly context = new Context();
  private readonly registered = new Map<string, { version: number; methods: HostCapabilityMethods }>();
  get versions(): Readonly<Record<string, number>> {
    return Object.fromEntries([...this.registered].map(([id, service]) => [id, service.version]));
  }
  async register(id: string, version: number, methods: HostCapabilityMethods): Promise<() => Promise<void>> {
    if (this.registered.has(id)) throw Error(`Host capability already registered: ${id}`);
    const services = this.registered;
    const fiber = await this.context.plugin({
      name: `host-${id}`,
      apply(ctx) {
        ctx.provide(id, methods);
        ctx.effect(() => {
          services.set(id, { version, methods });
          return () => { services.delete(id); };
        });
      },
    });
    return () => fiber.dispose();
  }
  async invoke(id: string, method: string, args: unknown, context: DesktopPluginCapabilityContext): Promise<unknown> {
    context.signal.throwIfAborted();
    const service = this.registered.get(id);
    if (!service || !Object.hasOwn(service.methods, method)) throw Error(`Unknown host capability method: ${id}.${method}`);
    const result = await service.methods[method]!(args, context);
    context.signal.throwIfAborted();
    return result;
  }
  async dispose(): Promise<void> { await this.context.fiber.dispose(); }
}
