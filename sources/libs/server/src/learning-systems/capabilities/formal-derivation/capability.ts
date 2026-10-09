import { capabilityToolSetFromTools } from "../../../agents/core/tool-capability.js";
import { defineLearningSystemCapability } from "../../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../../types.js";
import {
  FORMAL_DERIVATION_CAPABILITY_ID,
  FORMAL_DERIVATION_CAPABILITY_VERSION,
  FORMAL_DERIVATION_EXPANSION_TOOL_SET,
  FORMAL_DERIVATION_TOOL_SET,
  FORMAL_DERIVATION_VIEW_KEYS,
} from "./keys.js";
import {
  FORMAL_DERIVATION_AUTHORING_INSTRUCTION,
  FORMAL_DERIVATION_EXPANSION_INSTRUCTION,
} from "./prompt.js";
import {
  createFormalDerivationExpansionTools,
  createFormalDerivationTools,
} from "./tools.js";

export {
  FORMAL_DERIVATION_CAPABILITY_ID,
  FORMAL_DERIVATION_CAPABILITY_VERSION,
  FORMAL_DERIVATION_EXPANSION_OPERATION,
  FORMAL_DERIVATION_EXPANSION_PROMPT_VERSION,
  FORMAL_DERIVATION_EXPANSION_TOOL_SET,
  FORMAL_DERIVATION_OPERATION,
  UNIT_FORMAL_DERIVATION_OPERATION,
  FORMAL_DERIVATION_PROMPT_VERSION,
  FORMAL_DERIVATION_TOOL_SET,
  FORMAL_DERIVATION_VIEW_KEYS,
} from "./keys.js";
export {
  FORMAL_DERIVATION_AUTHORING_INSTRUCTION,
  FORMAL_DERIVATION_EXPANSION_INSTRUCTION,
} from "./prompt.js";
export { configureFormalDerivationPersistence } from "./persistence.js";

function instructionView(promptBlock: string) {
  return async ({
    subject,
  }: SystemViewRequest): Promise<ContextEnvelope | null> => ({
    ownerCapabilityId: FORMAL_DERIVATION_CAPABILITY_ID,
    ownerCapabilityVersion: FORMAL_DERIVATION_CAPABILITY_VERSION,
    schemaVersion: 1,
    authority: "server_policy",
    scope: { ...subject },
    freshness: {
      asOf: new Date(0).toISOString(),
      stale: false,
    },
    data: { promptBlock },
  });
}

export function createFormalDerivationCapability() {
  return defineLearningSystemCapability({
    id: FORMAL_DERIVATION_CAPABILITY_ID,
    version: FORMAL_DERIVATION_CAPABILITY_VERSION,
    kind: "learning_system",
    views: {
      [FORMAL_DERIVATION_VIEW_KEYS.authoringInstruction]: instructionView(
        FORMAL_DERIVATION_AUTHORING_INSTRUCTION,
      ),
      [FORMAL_DERIVATION_VIEW_KEYS.expansionInstruction]: instructionView(
        FORMAL_DERIVATION_EXPANSION_INSTRUCTION,
      ),
    },
    toolSets: [
      capabilityToolSetFromTools({
        key: FORMAL_DERIVATION_TOOL_SET,
        ownerCapabilityId: FORMAL_DERIVATION_CAPABILITY_ID,
        ownerCapabilityVersion: FORMAL_DERIVATION_CAPABILITY_VERSION,
        description:
          "Allowlisted tools for inspecting, committing, validating, and finishing a formal derivation run.",
        requiredScopes: ["user", "thread"],
        tools: createFormalDerivationTools(),
      }),
      capabilityToolSetFromTools({
        key: FORMAL_DERIVATION_EXPANSION_TOOL_SET,
        ownerCapabilityId: FORMAL_DERIVATION_CAPABILITY_ID,
        ownerCapabilityVersion: FORMAL_DERIVATION_CAPABILITY_VERSION,
        description:
          "Allowlisted tools for expanding one teaching step into a finer linear sequence.",
        requiredScopes: ["user", "thread"],
        tools: createFormalDerivationExpansionTools(),
      }),
    ],
  });
}
