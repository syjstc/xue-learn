import { DynamicStructuredTool } from "@langchain/core/tools";
import type { z } from "zod";
import { projectProviderBindingSchema } from "../../providers/llm/provider-binding-schema.js";
import type { AgentToolDef } from "./types.js";
export {
  capabilityToolSetFromTools,
  capabilityToolSetsFromTools,
  defineCapabilityToolSet,
  ToolCapabilitySession,
} from "./tool-capability.js";
export type {
  CapabilityToolSet,
  ToolOperationProfile,
  ToolSetLoadResult,
  ToolSetProfile,
} from "./tool-capability.js";

export function defineAgentTool<T extends z.ZodType>(
  def: AgentToolDef<T>,
): AgentToolDef<T> {
  return def;
}

export function toLangChainTools(
  defs: AgentToolDef[],
): DynamicStructuredTool[] {
  return defs.map(
    (def) =>
      new DynamicStructuredTool({
        name: def.name,
        description: def.description,
        // Tool bindings are disposable provider transport contracts. Keep the
        // original Zod schema authoritative for execution while projecting out
        // unsupported constraints and normalizing provider schema dialects.
        schema: projectProviderBindingSchema(def.schema),
        func: async () => "",
      }),
  );
}
