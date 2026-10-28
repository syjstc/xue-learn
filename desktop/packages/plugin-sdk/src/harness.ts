import type { DesktopCordisPlugin } from './cordis.js';

/** A source-level compatibility check, not a guarantee about a module's imports. */
export interface HarnessCompatibility {
  compatible: boolean;
  requiredServices: string[];
  missingServices: string[];
  unsupported: string[];
}

// `void` allows normal author functions to return a value. At runtime Cordis
// receives that value intact and owns any returned cleanup effect.
type Apply = (context: unknown, config: unknown) => void | Promise<void>;
type Metadata = Record<string, unknown>;
const HOST_SERVICES = ['desktop'];

function unpack(input: unknown): { metadata: Metadata; apply?: Apply; unsupported: string[] } {
  // Accept an ESM namespace, its default export, or a CommonJS plugin value.
  const source = input && typeof input === 'object' && 'default' in input
    ? (input as Metadata).default : input;
  if (!source || (typeof source !== 'object' && typeof source !== 'function')) {
    return { metadata: {}, unsupported: ['Expected a function or an object with apply()'] };
  }
  const metadata = source as Metadata;
  if (typeof source === 'function' && /^class(?:\s|\{)/.test(Function.prototype.toString.call(source))) {
    return { metadata, unsupported: ['Harness Service classes require the Harness Cordis runtime'] };
  }
  const apply = typeof source === 'function' ? source as Apply
    : typeof metadata.apply === 'function' ? metadata.apply as Apply : undefined;
  const unsupported = apply ? [] : ['Expected a function or an object with apply()'];
  if (metadata.provide !== undefined || metadata.intercept !== undefined) {
    unsupported.push('Plugin-level provide/intercept metadata requires a dedicated adapter');
  }
  return { metadata, apply, unsupported };
}

/**
 * Inspect declared dependencies before packaging. Desktop only supplies `desktop`;
 * this adapter does not fabricate agents, tools, sessions, webServer or UI services.
 */
export function inspectHarnessPlugin(input: unknown): HarnessCompatibility {
  const { metadata, unsupported } = unpack(input);
  let requiredServices: string[] = [];
  if (metadata.inject !== undefined) {
    if (!Array.isArray(metadata.inject) || metadata.inject.some(name => typeof name !== 'string' || !name)) {
      unsupported.push('Only an array of required service names is supported in inject');
    } else {
      requiredServices = [...new Set(metadata.inject as string[])];
    }
  }
  if (metadata.Config !== undefined) {
    const standard = (metadata.Config as { '~standard'?: { validate?: unknown } } | null)?.['~standard'];
    if (!standard || typeof standard.validate !== 'function') {
      unsupported.push('Config must implement synchronous Standard Schema validation');
    }
  }
  const missingServices = requiredServices.filter(name => !HOST_SERVICES.includes(name));
  return { compatible: !unsupported.length && !missingServices.length, requiredServices, missingServices, unsupported };
}

function resolveConfig(schema: unknown, config: unknown): unknown {
  if (schema === undefined) return config;
  const standard = (schema as { '~standard': { validate(value: unknown): unknown } })['~standard'];
  const result = standard.validate(config);
  if (!result || typeof result !== 'object') throw new Error('Harness Config returned an invalid validation result');
  if ('then' in result) throw new Error('Asynchronous Harness Config validation is not supported');
  if ('issues' in result && result.issues !== undefined) {
    const messages = Array.isArray(result.issues)
      ? result.issues.map(issue => typeof issue?.message === 'string' ? issue.message : 'Invalid config').join('; ')
      : 'Invalid validation issues';
    throw new Error(`Invalid Harness plugin config: ${messages}`);
  }
  if (!('value' in result)) throw new Error('Harness Config did not return a value');
  return result.value;
}

/**
 * Reuse a portable Harness apply function with Desktop's Cordis lifecycle.
 *
 * Only dependency-free plugins (or plugins explicitly ported to `desktop`) are
 * accepted. Bundle this helper and the plugin's non-Cordis dependencies into the
 * package. A runtime import of @deepseek-ai/cordis, a Service subclass, Harness
 * profile, client module or Harness service graph needs a separate port.
 *
 * `config` is the Harness plugin's configuration, never Desktop's paths/manifest.
 * The original Standard Schema validator still runs on every activation.
 */
export function adaptHarnessPlugin(input: unknown, options: { config: unknown }): DesktopCordisPlugin {
  const report = inspectHarnessPlugin(input);
  if (!report.compatible) {
    const problems = [...report.unsupported];
    if (report.missingServices.length) problems.push(`Missing Harness services: ${report.missingServices.join(', ')}`);
    throw new Error(`Cannot adapt Harness plugin: ${problems.join('; ')}`);
  }
  const { metadata, apply } = unpack(input);
  return {
    name: typeof metadata.name === 'string' ? metadata.name : 'harness-apply-adapter',
    inject: report.requiredServices,
    apply(context) {
      // Returning the original effect lets the real Cordis runner own generators,
      // async disposers and startup errors instead of emulating their lifecycle.
      return apply!(context, resolveConfig(metadata.Config, options.config));
    },
  };
}
