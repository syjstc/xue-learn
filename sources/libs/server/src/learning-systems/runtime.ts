import {
  configureGenerationContextResolver,
  type GenerationContextContribution,
  type GenerationContextResolver,
} from "../generation/kernel.js";
import { getLlmOperationDefinition } from "../providers/llm/operation-catalog.js";
import {
  DEFAULT_ACTIVATION_RESOLVER,
  DEFAULT_SUBJECT_RESOLVER,
  type LearningSystemActivationResolver,
  type LearningSystemSubjectResolver,
} from "./activation.js";
import { SystemCommandRouter } from "./command-router.js";
import { ContextBroker } from "./context-broker.js";
import { LearningSystemRegistry } from "./registry.js";
import { CapabilitySettingsRouter } from "./settings-router.js";
import type { LearningSystemCapability, ResolvedContextView } from "./types.js";
import { createToolCapability, TOOL_CAPABILITY_ID } from "./capabilities/tool.js";

export type LearningSystemRuntime = {
  registry: LearningSystemRegistry;
  contextBroker: ContextBroker;
  commandRouter: SystemCommandRouter;
  settingsRouter: CapabilitySettingsRouter;
  activationResolver: LearningSystemActivationResolver;
  subjectResolver: LearningSystemSubjectResolver;
};

function renderContextData(data: unknown): string {
  if (typeof data === "string") return data;
  if (
    data &&
    typeof data === "object" &&
    (("promptBlock" in data &&
      typeof (data as { promptBlock?: unknown }).promptBlock === "string") ||
      ("prompt" in data &&
        typeof (data as { prompt?: unknown }).prompt === "string"))
  ) {
    return "promptBlock" in data
      ? (data as { promptBlock: string }).promptBlock
      : (data as { prompt: string }).prompt;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function toContribution(
  view: ResolvedContextView,
): GenerationContextContribution {
  return {
    viewKey: view.profile.key,
    envelope: view.envelope,
    rendered: renderContextData(view.envelope.data),
    estimatedTokens: view.estimatedTokens,
    truncated: view.truncated,
    promptLayer: view.profile.promptLayer,
    promptOrder: view.profile.promptOrder,
    semanticClass: view.profile.semanticClass,
  };
}

export function createLearningSystemRuntime(options: {
  capabilities: readonly LearningSystemCapability[];
  activationResolver?: LearningSystemActivationResolver;
  subjectResolver?: LearningSystemSubjectResolver;
}): LearningSystemRuntime {
  const registry = new LearningSystemRegistry();
  if (
    options.capabilities.some(
      (capability) =>
        capability.manifest.id === TOOL_CAPABILITY_ID ||
        capability.manifest.kind === "tool_capability",
    )
  ) {
    throw new Error(
      "Tool Capability is platform-owned and must not be supplied by callers",
    );
  }
  registry.register(createToolCapability());
  for (const capability of options.capabilities) registry.register(capability);
  registry.seal();
  const activationResolver =
    options.activationResolver ?? DEFAULT_ACTIVATION_RESOLVER;
  const subjectResolver = options.subjectResolver ?? DEFAULT_SUBJECT_RESOLVER;
  return {
    registry,
    activationResolver,
    subjectResolver,
    contextBroker: new ContextBroker(registry, { activationResolver }),
    commandRouter: new SystemCommandRouter(registry),
    settingsRouter: new CapabilitySettingsRouter(registry),
  };
}

/**
 * Installs the runtime into the generation kernel. Reinstalling is explicit so
 * tests and separate service processes can build isolated registries.
 */
export function installGenerationContextRuntime(
  runtime: LearningSystemRuntime | undefined,
): void {
  if (!runtime) {
    configureGenerationContextResolver(undefined);
    return;
  }
  configureGenerationContextResolver(createGenerationContextResolver(runtime));
}

/** Explicit composition for independent consumers, without changing the learner runtime. */
export function createGenerationContextResolver(runtime: LearningSystemRuntime): GenerationContextResolver {
  return async ({ operation, scope }) => {
    const definition = getLlmOperationDefinition(operation);
    if (!definition) {
      throw new Error(`Unregistered LLM operation "${operation}"`);
    }
    const subject = await runtime.subjectResolver.resolve(scope.subject);
    const result = await runtime.contextBroker.resolve({
      operation,
      profile: definition.contextProfile,
      subject,
      query: scope.query,
      invocation: scope.invocation,
    });
    return {
      contributions: result.views.map(toContribution),
      diagnostics: result.diagnostics.map(({ key, code, message }) => ({
        key,
        code,
        message,
      })),
    };
  };
}
