import type { z } from "zod";
import type { LearningSystemActivationResolver } from "../../learning-systems/activation.js";
import { LearningSystemRegistry } from "../../learning-systems/registry.js";
import {
  resolveCapabilityQueryTools,
  type ResolvedCapabilityQueryTool,
} from "../../learning-systems/query-tools.js";
import { CapabilityQueryToolGateway } from "../../learning-systems/tool-gateway.js";
import type {
  BoundToolSubject,
  ContextEnvelope,
  LearningSystemCapability,
} from "../../learning-systems/types.js";
import {
  resolveGenerationContextMode,
  type GenerationContextMode,
} from "../../generation/kernel.js";
import { getLlmOperationDefinition } from "../../providers/llm/operation-catalog.js";
import type { AgentToolDef } from "./types.js";

const MAX_LLM_TOOL_NAME_LENGTH = 64;

export type CapabilityAgentQueryTools = {
  tools: AgentToolDef[];
  gateway: CapabilityQueryToolGateway;
  unavailableToolKeys: string[];
  resolvedToolKeys: string[];
  mode: GenerationContextMode;
  parityError?: string;
};

export type CreateCapabilityAgentQueryToolsOptions = {
  registry: LearningSystemRegistry;
  activationResolver: LearningSystemActivationResolver;
  operation: string;
  subject: BoundToolSubject;
  signal?: AbortSignal;
  selectedToolKeys?: readonly string[];
  presentationAdapters?: Readonly<
    Record<string, Pick<AgentToolDef, "renderUi">>
  >;
};

export type AgentCapabilityQueryResult = {
  data: unknown;
  authority: ContextEnvelope["authority"];
  scope: ContextEnvelope["scope"];
  freshness: ContextEnvelope["freshness"];
  provenance: {
    capabilityId: string;
    capabilityVersion: string;
    schemaVersion: number;
  };
};

/**
 * Bridges operation-allowlisted capability query tools into the existing agent
 * runtime without exposing the registry, capability identities, or write plane
 * to the model.
 *
 * The returned gateway is intentionally shared by every generated tool
 * handler. Its per-tool call limits and total lazy-context token budget
 * therefore apply to the complete agent run rather than to individual calls.
 */
export async function createCapabilityAgentQueryTools({
  registry,
  activationResolver,
  operation,
  subject,
  signal,
  selectedToolKeys,
  presentationAdapters,
}: CreateCapabilityAgentQueryToolsOptions): Promise<CapabilityAgentQueryTools> {
  const definition = getLlmOperationDefinition(operation);
  if (!definition) {
    throw new Error(`Unregistered LLM operation "${operation}"`);
  }

  const mode = resolveGenerationContextMode();
  const emptyGateway = () =>
    new CapabilityQueryToolGateway({
      tools: [],
      subject,
      maxLazyContextTokens: definition.contextProfile.maxLazyContextTokens,
    });

  if (mode === "legacy" || definition.contextProfile.lazyTools.length === 0) {
    return {
      tools: [],
      gateway: emptyGateway(),
      unavailableToolKeys: [],
      resolvedToolKeys: [],
      mode,
    };
  }

  try {
    const activeCapabilities = await resolveActiveCapabilities(
      registry,
      activationResolver,
      subject,
    );
    const activeToolKeys = new Set(
      activeCapabilities.flatMap(
        (capability) => capability.manifest.providesQueryTools ?? [],
      ),
    );
    const selectedKeys = selectedToolKeys ? new Set(selectedToolKeys) : null;
    const unknownSelectedKeys =
      selectedKeys === null
        ? []
        : [...selectedKeys].filter(
            (key) =>
              !definition.contextProfile.lazyTools.some(
                (profile) => profile.key === key,
              ),
          );
    if (unknownSelectedKeys.length > 0) {
      throw new Error(
        `Selected query tools are not allowlisted for "${operation}": ${unknownSelectedKeys.join(", ")}`,
      );
    }
    const selectedProfiles = selectedKeys
      ? definition.contextProfile.lazyTools.filter((profile) =>
          selectedKeys.has(profile.key),
        )
      : definition.contextProfile.lazyTools;
    const availableProfiles = selectedProfiles.filter((profile) =>
      activeToolKeys.has(profile.key),
    );
    const unavailableToolKeys = selectedProfiles
      .filter((profile) => !activeToolKeys.has(profile.key))
      .map((profile) => profile.key);
    const resolvedTools = resolveCapabilityQueryTools(
      availableProfiles,
      activeCapabilities,
    );
    const gateway = new CapabilityQueryToolGateway({
      tools: resolvedTools,
      subject,
      maxLazyContextTokens: definition.contextProfile.maxLazyContextTokens,
    });

    const names = new Set<string>();
    const resolvedAgentTools = resolvedTools.map((resolved) => {
      const name = toLlmSafeToolName(resolved.tool.key);
      if (names.has(name)) {
        throw new Error(
          `Capability query tool names collide after LLM-safe normalization: "${name}"`,
        );
      }
      names.add(name);
      const tool = toAgentToolDef(resolved, name, gateway, signal);
      const presentation = presentationAdapters?.[resolved.tool.key];
      return presentation?.renderUi
        ? { ...tool, renderUi: presentation.renderUi }
        : tool;
    });

    return {
      tools: mode === "enforced" ? resolvedAgentTools : [],
      gateway,
      unavailableToolKeys,
      resolvedToolKeys: resolvedTools.map(({ tool }) => tool.key),
      mode,
    };
  } catch (error) {
    if (mode !== "shadow") throw error;
    return {
      tools: [],
      gateway: emptyGateway(),
      unavailableToolKeys: definition.contextProfile.lazyTools.map(
        ({ key }) => key,
      ),
      resolvedToolKeys: [],
      mode,
      parityError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveOperationMaxToolRounds(
  operation: string,
  fallback: number,
): number {
  const configured =
    getLlmOperationDefinition(operation)?.contextProfile.maxToolRounds;
  return typeof configured === "number" &&
    Number.isInteger(configured) &&
    configured >= 0
    ? configured
    : fallback;
}

async function resolveActiveCapabilities(
  registry: LearningSystemRegistry,
  activationResolver: LearningSystemActivationResolver,
  subject: BoundToolSubject,
): Promise<LearningSystemCapability[]> {
  const capabilities = registry.getCapabilities();
  const activation = await Promise.all(
    capabilities.map((capability) =>
      activationResolver.isActive({ capability, subject }),
    ),
  );
  return capabilities.filter((_, index) => activation[index]);
}

function toAgentToolDef(
  resolved: ResolvedCapabilityQueryTool,
  name: string,
  gateway: CapabilityQueryToolGateway,
  runSignal?: AbortSignal,
): AgentToolDef<z.ZodType> {
  return {
    name,
    description: resolved.tool.description,
    schema: resolved.tool.inputSchema,
    capabilityUsage: {
      type: "query_tool",
      key: resolved.tool.key,
      capabilityId: resolved.tool.ownerCapabilityId,
      capabilityVersion: resolved.ownerCapabilityVersion,
      schemaVersion: resolved.tool.schemaVersion,
    },
    handler: async (input, ctx) => {
      const envelope = await gateway.execute({
        key: resolved.tool.key,
        input,
        signal: runSignal ?? ctx.signal,
      });
      return toJsonSafeAgentResult(envelope);
    },
  };
}

function toJsonSafeAgentResult(
  envelope: ContextEnvelope,
): AgentCapabilityQueryResult {
  const result: AgentCapabilityQueryResult = {
    data: envelope.data,
    authority: envelope.authority,
    scope: envelope.scope,
    freshness: envelope.freshness,
    provenance: {
      capabilityId: envelope.ownerCapabilityId,
      capabilityVersion: envelope.ownerCapabilityVersion,
      schemaVersion: envelope.schemaVersion,
    },
  };

  try {
    const serialized = JSON.stringify(result);
    if (serialized === undefined) {
      throw new Error("Capability query result is not JSON serializable");
    }
    return JSON.parse(serialized) as AgentCapabilityQueryResult;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`Capability query result is not JSON-safe${detail}`);
  }
}

function toLlmSafeToolName(key: string): string {
  let normalized = key
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) normalized = "capability_query";
  if (normalized.length <= MAX_LLM_TOOL_NAME_LENGTH) return normalized;

  const suffix = `_${stableHash(key)}`;
  return `${normalized.slice(
    0,
    MAX_LLM_TOOL_NAME_LENGTH - suffix.length,
  )}${suffix}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
