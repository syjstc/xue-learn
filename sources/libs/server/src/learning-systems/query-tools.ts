import type {
  CapabilityQueryTool,
  LazyToolProfile,
  LearningSystemCapability,
} from "./types.js";

export type QueryToolResolutionErrorCode =
  | "duplicate_profile"
  | "duplicate_tool"
  | "invalid_profile"
  | "invalid_tool_owner"
  | "manifest_mismatch"
  | "missing_tool";

export class QueryToolResolutionError extends Error {
  constructor(
    readonly code: QueryToolResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QueryToolResolutionError";
  }
}

export type ResolvedCapabilityQueryTool = {
  profile: LazyToolProfile;
  tool: CapabilityQueryTool;
  ownerCapabilityVersion: string;
};

/**
 * Resolves the operation's allowlisted lazy tools from capabilities that have
 * already passed activation policy. This deliberately does not expose the
 * registry or capabilities themselves to an LLM-facing adapter.
 */
export function resolveCapabilityQueryTools(
  profiles: readonly LazyToolProfile[],
  activeCapabilities: readonly LearningSystemCapability[],
): ResolvedCapabilityQueryTool[] {
  const profileByKey = new Map<string, LazyToolProfile>();
  for (const profile of profiles) {
    if (profileByKey.has(profile.key)) {
      throw new QueryToolResolutionError(
        "duplicate_profile",
        `Lazy query tool "${profile.key}" is listed more than once`,
      );
    }
    if (
      !profile.key ||
      !Number.isInteger(profile.maxCalls) ||
      profile.maxCalls <= 0 ||
      !Number.isFinite(profile.maxResultTokens) ||
      profile.maxResultTokens <= 0
    ) {
      throw new QueryToolResolutionError(
        "invalid_profile",
        `Lazy query tool profile "${profile.key}" has invalid limits`,
      );
    }
    profileByKey.set(profile.key, profile);
  }

  const toolsByKey = new Map<
    string,
    { tool: CapabilityQueryTool; capabilityVersion: string }
  >();

  for (const capability of activeCapabilities) {
    const advertised = new Set(capability.manifest.providesQueryTools ?? []);
    const tools = capability.getQueryTools?.() ?? [];
    const providedByCapability = new Set<string>();

    for (const tool of tools) {
      if (tool.ownerCapabilityId !== capability.manifest.id) {
        throw new QueryToolResolutionError(
          "invalid_tool_owner",
          `Query tool "${tool.key}" declares owner "${tool.ownerCapabilityId}" but was provided by "${capability.manifest.id}"`,
        );
      }
      if (!advertised.has(tool.key)) {
        throw new QueryToolResolutionError(
          "manifest_mismatch",
          `Capability "${capability.manifest.id}" returned undeclared query tool "${tool.key}"`,
        );
      }
      if (providedByCapability.has(tool.key) || toolsByKey.has(tool.key)) {
        throw new QueryToolResolutionError(
          "duplicate_tool",
          `Query tool "${tool.key}" has more than one active provider`,
        );
      }

      providedByCapability.add(tool.key);
      toolsByKey.set(tool.key, {
        tool,
        capabilityVersion: capability.manifest.version,
      });
    }

    for (const key of advertised) {
      if (!providedByCapability.has(key)) {
        throw new QueryToolResolutionError(
          "manifest_mismatch",
          `Capability "${capability.manifest.id}" advertises query tool "${key}" but does not provide it`,
        );
      }
    }
  }

  return profiles.map((profile) => {
    const resolved = toolsByKey.get(profile.key);
    if (!resolved) {
      throw new QueryToolResolutionError(
        "missing_tool",
        `Required lazy query tool "${profile.key}" is not provided by an active capability`,
      );
    }
    return {
      profile,
      tool: resolved.tool,
      ownerCapabilityVersion: resolved.capabilityVersion,
    };
  });
}
