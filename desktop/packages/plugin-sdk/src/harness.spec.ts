import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { adaptHarnessPlugin, inspectHarnessPlugin } from './harness';

describe('portable Harness apply adapter', () => {
  it('accepts function, named ESM exports and default-export objects', () => {
    for (const input of [() => {}, { name: 'plain', apply() {} }, { default: { apply() {} } }]) {
      expect(inspectHarnessPlugin(input)).toEqual({ compatible: true, requiredServices: [], missingServices: [], unsupported: [] });
    }
  });

  it('reports the services used by official no-UI and Inspector plugin shapes', () => {
    expect(inspectHarnessPlugin({ inject: ['agents', 'sessionProjections'], apply() {} }).missingServices).toEqual(['agents', 'sessionProjections']);
    expect(() => adaptHarnessPlugin({ inject: ['webServer', 'connection'], apply() {} }, { config: {} }))
      .toThrow('Missing Harness services: webServer, connection');
  });

  it('rejects class plugins and metadata that needs Harness runtime behavior', () => {
    expect(() => adaptHarnessPlugin(class HarnessService {}, { config: {} })).toThrow('Service classes');
    expect(inspectHarnessPlugin({ inject: { tools: true }, apply() {} }).compatible).toBe(false);
    expect(inspectHarnessPlugin({ provide: 'custom', apply() {} }).compatible).toBe(false);
    expect(inspectHarnessPlugin({ Config: () => ({}), apply() {} }).compatible).toBe(false);
  });

  it('keeps plugin config separate and preserves schema rejection before side effects', () => {
    const apply = jest.fn();
    const Config = { '~standard': { validate: () => ({ issues: [{ message: 'port must be positive' }] }) } };
    const adapter = adaptHarnessPlugin({ Config, apply }, { config: { port: -1 } });
    expect(() => adapter.apply({} as never, {} as never)).toThrow('port must be positive');
    expect(apply).not.toHaveBeenCalled();
    const asyncAdapter = adaptHarnessPlugin({ Config: { '~standard': { validate: async () => ({ value: {} }) } }, apply }, { config: {} });
    expect(() => asyncAdapter.apply({} as never, {} as never)).toThrow('Asynchronous');
  });

  it('runs real Cordis effects, schema defaults, events and repeated cleanup without a second runtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harness-adapter-'));
    try {
      const entry = join(directory, 'verify.cjs');
      await build({
        stdin: { resolveDir: process.cwd(), sourcefile: 'harness-smoke.ts', loader: 'ts', contents: `
          import { Context } from 'cordis';
          import { adaptHarnessPlugin } from ${JSON.stringify(resolve(__dirname, 'harness.ts'))};
          (async () => {
            const ctx = new Context();
            const event = Symbol('portable-event');
            const log = [];
            const module = {
              name: 'portable-background',
              Config: { '~standard': { validate: value => ({ value: { label: value?.label ?? 'default' } }) } },
              apply(ctx, config) {
                log.push('start:' + config.label);
                ctx.on(event, () => log.push('event'));
                ctx.effect(function* () { yield async () => { await Promise.resolve(); log.push('cleanup'); }; });
                return () => log.push('return-disposer');
              }
            };
            const adapter = adaptHarnessPlugin(module, { config: {} });
            const first = await ctx.plugin(adapter, { storagePath: 'must-not-be-plugin-config' });
            ctx.emit(event);
            await first.dispose();
            ctx.emit(event);
            const second = await ctx.plugin(adapter, {});
            await second.dispose();
            await ctx.fiber.dispose();
            process.stdout.write(JSON.stringify({ state: first.state, log }));
          })().catch(error => { console.error(error); process.exitCode = 1; });
        ` },
        outfile: entry, bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'silent',
      });
      const result = JSON.parse(execFileSync(process.execPath, [entry], { encoding: 'utf8' }));
      expect(result.state).toBe(4);
      expect(result.log).toEqual(['start:default', 'event', 'return-disposer', 'cleanup', 'start:default', 'return-disposer', 'cleanup']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
