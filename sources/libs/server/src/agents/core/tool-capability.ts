import { z } from "zod";
import type {
  LearningSystemSubject,
  SubjectScope,
} from "../../learning-systems/types.js";
import { defineAgentTool } from "./tools.js";
import type { AgentRunContext, AgentToolDef } from "./types.js";

export type CapabilityToolKind = "query" | "action" | "command";

export type CapabilityToolSet = {
  key: string;
  ownerCapabilityId: string;
  ownerCapabilityVersion: string;
  version: string;
  description: string;
  requiredScopes?: SubjectScope[];
  tools: AgentToolDef[];
};

export type ToolSetProfile = {
  key: string;
  maxCalls?: number;
  maxResultTokens?: number;
};

export type ToolOperationProfile = {
  preloadedToolSets: ToolSetProfile[];
  loadableToolSets: ToolSetProfile[];
  builtinTools: readonly "get_tool_set"[];
  maxToolRounds: number;
  maxToolCalls: number;
  maxResultTokens: number;
};

export type ToolSetLoadResult =
  | {
      loaded: true;
      alreadyLoaded: boolean;
      toolSet: string;
      tools: string[];
    }
  | {
      loaded: false;
      toolSet: string;
      reason: "not_allowlisted" | "unavailable" | "inactive";
    };

type ToolCapabilitySessionOptions = {
  operation: string;
  subject: LearningSystemSubject;
  toolSets: readonly CapabilityToolSet[];
  preloadedToolSetKeys?: readonly string[];
  loadableToolSetKeys?: readonly string[];
  includeGetToolSet?: boolean;
  maxToolCalls?: number;
};

function assertRequiredScopes(
  subject: LearningSystemSubject,
  scopes: readonly SubjectScope[],
  setKey: string,
): void {
  for (const scope of scopes) {
    const value =
      scope === "user"
        ? subject.userId
        : scope === "goal"
          ? subject.goalId
          : scope === "unit"
            ? subject.unitId
            : subject.threadId;
    if (!value) {
      throw new Error(`Tool set "${setKey}" requires bound ${scope} scope`);
    }
  }
}

/**
 * Sole model-facing gateway for executable tools.
 *
 * Capability owners contribute already-bound tool definitions, while this
 * session owns allowlisting, dynamic set loading, name collision checks and
 * the final AgentToolDef list supplied to a provider.
 */
export class ToolCapabilitySession {
  private readonly sets = new Map<string, CapabilityToolSet>();
  private readonly loaded = new Set<string>();
  private readonly loadable: Set<string>;
  private readonly calls = new Map<string, number>();
  private revision = 0;

  constructor(private readonly options: ToolCapabilitySessionOptions) {
    for (const set of options.toolSets) {
      if (!set.key.trim() || !set.description.trim()) {
        throw new Error("Tool set key and description are required");
      }
      if (this.sets.has(set.key)) {
        throw new Error(`Duplicate tool set "${set.key}"`);
      }
      assertRequiredScopes(options.subject, set.requiredScopes ?? [], set.key);
      this.sets.set(set.key, set);
    }
    this.loadable = new Set(options.loadableToolSetKeys ?? []);
    for (const key of options.preloadedToolSetKeys ?? []) {
      if (!this.sets.has(key)) {
        throw new Error(
          `Preloaded tool set "${key}" is unavailable for "${options.operation}"`,
        );
      }
      this.loaded.add(key);
    }
    this.assertUniqueExposedNames();
  }

  getRevision(): number {
    return this.revision;
  }

  getLoadedToolSetKeys(): string[] {
    return [...this.loaded];
  }

  getAvailableToolSetKeys(): string[] {
    return [...this.loadable].filter(
      (key) => this.sets.has(key) && !this.loaded.has(key),
    );
  }

  loadToolSet(key: string): ToolSetLoadResult {
    if (!this.loadable.has(key)) {
      return { loaded: false, toolSet: key, reason: "not_allowlisted" };
    }
    const set = this.sets.get(key);
    if (!set) {
      return { loaded: false, toolSet: key, reason: "unavailable" };
    }
    if (this.loaded.has(key)) {
      return {
        loaded: true,
        alreadyLoaded: true,
        toolSet: key,
        tools: set.tools.map((tool) => tool.name),
      };
    }
    this.loaded.add(key);
    this.assertUniqueExposedNames();
    this.revision += 1;
    return {
      loaded: true,
      alreadyLoaded: false,
      toolSet: key,
      tools: set.tools.map((tool) => tool.name),
    };
  }

  getExposedTools(): AgentToolDef[] {
    const tools: AgentToolDef[] = [...this.loaded].flatMap((key) => {
      const set = this.sets.get(key)!;
      return set.tools.map((tool) => ({
        ...tool,
        capabilityUsage: tool.capabilityUsage
          ? { ...tool.capabilityUsage, toolSetKey: set.key }
          : ({
              type: "action_tool",
              key: tool.name,
              capabilityId: set.ownerCapabilityId,
              capabilityVersion: set.ownerCapabilityVersion,
              schemaVersion: 1,
              toolSetKey: set.key,
            } as const),
      }));
    });
    const available = this.getAvailableToolSetKeys();
    if (this.options.includeGetToolSet !== false && available.length > 0) {
      tools.unshift(this.createGetToolSetTool(available));
    }
    return tools;
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolCapabilityExecutionContext,
  ): Promise<unknown> {
    const tool = this.getExposedTools().find(
      (candidate) => candidate.name === name,
    );
    if (!tool) {
      throw new Error(`Executable tool "${name}" is not exposed`);
    }
    const parsed = tool.schema.parse(input);
    const count = (this.calls.get(name) ?? 0) + 1;
    const totalCalls = [...this.calls.values()].reduce(
      (total, value) => total + value,
      0,
    );
    if (
      this.options.maxToolCalls != null &&
      totalCalls >= this.options.maxToolCalls
    ) {
      throw new Error(
        `Tool call budget exhausted for "${this.options.operation}"`,
      );
    }
    this.calls.set(name, count);
    return tool.handler(parsed, {
      ...context,
      toolSubject: { ...this.options.subject },
    });
  }

  private createGetToolSetTool(keys: string[]): AgentToolDef {
    const values = keys as [string, ...string[]];
    return defineAgentTool({
      name: "get_tool_set",
      description:
        "Silently load an allowlisted internal tool set when the currently available tools cannot handle the learner's request. Call this without any user-facing preamble or explanation.",
      schema: z.object({
        toolSet: z.enum(values),
      }),
      capabilityUsage: {
        type: "builtin_tool",
        key: "get_tool_set",
        capabilityId: "tool",
        capabilityVersion: "1.0.0",
        schemaVersion: 1,
      },
      handler: async (args) => this.loadToolSet(args.toolSet),
    });
  }

  private assertUniqueExposedNames(): void {
    const names = new Set<string>();
    for (const key of this.loaded) {
      for (const tool of this.sets.get(key)!.tools) {
        if (tool.name === "get_tool_set") {
          throw new Error('"get_tool_set" is reserved by Tool Capability');
        }
        if (names.has(tool.name)) {
          throw new Error(
            `Executable tool name "${tool.name}" is exposed by more than one loaded tool set`,
          );
        }
        names.add(tool.name);
      }
    }
  }
}

export function defineCapabilityToolSet(
  definition: CapabilityToolSet,
): CapabilityToolSet {
  return definition;
}

export function capabilityToolSetFromTools(options: {
  key: string;
  ownerCapabilityId: string;
  ownerCapabilityVersion?: string;
  version?: string;
  description: string;
  requiredScopes?: SubjectScope[];
  tools: AgentToolDef[];
}): CapabilityToolSet {
  return defineCapabilityToolSet({
    key: options.key,
    ownerCapabilityId: options.ownerCapabilityId,
    ownerCapabilityVersion: options.ownerCapabilityVersion ?? "1.0.0",
    version: options.version ?? "1.0.0",
    description: options.description,
    requiredScopes: options.requiredScopes,
    tools: options.tools,
  });
}

export function capabilityToolSetsFromTools(
  tools: readonly AgentToolDef[],
): CapabilityToolSet[] {
  const grouped = new Map<string, AgentToolDef[]>();
  for (const tool of tools) {
    const owner = tool.capabilityUsage?.capabilityId;
    if (!owner) {
      throw new Error(
        `Tool "${tool.name}" has no capability ownership metadata`,
      );
    }
    const owned = grouped.get(owner) ?? [];
    owned.push(tool);
    grouped.set(owner, owned);
  }
  return [...grouped].map(([ownerCapabilityId, ownedTools]) =>
    capabilityToolSetFromTools({
      key: `capability.${ownerCapabilityId}`,
      ownerCapabilityId,
      ownerCapabilityVersion:
        ownedTools[0]?.capabilityUsage?.capabilityVersion ?? "1.0.0",
      description: `Model-facing tools owned by ${ownerCapabilityId}.`,
      tools: ownedTools,
    }),
  );
}

export type ToolCapabilityExecutionContext = AgentRunContext & {
  state: Record<string, unknown>;
};
