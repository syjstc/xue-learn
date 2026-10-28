import { capabilityToolSetFromTools } from "../../../agents/core/tool-capability.js";
import { defineLearningSystemCapability } from "../../define-capability.js";
import type { ContextEnvelope, SystemViewRequest } from "../../types.js";
import {
  TEACHING_DERIVATION_CAPABILITY_ID,
  TEACHING_DERIVATION_CAPABILITY_VERSION,
  TEACHING_DERIVATION_TOOL_SET,
  TEACHING_DERIVATION_VIEW_KEYS,
} from "./keys.js";
import { TEACHING_DERIVATION_AUTHORING_INSTRUCTION } from "./prompt.js";
import { createTeachingDerivationTools } from "./tools.js";

export {
  TEACHING_DERIVATION_CAPABILITY_ID,
  TEACHING_DERIVATION_CAPABILITY_VERSION,
  UNIT_TEACHING_DERIVATION_OPERATION,
  TEACHING_DERIVATION_PROMPT_VERSION,
  TEACHING_DERIVATION_TOOL_SET,
  TEACHING_DERIVATION_VIEW_KEYS,
} from "./keys.js";
export { TEACHING_DERIVATION_AUTHORING_INSTRUCTION } from "./prompt.js";
export { configureTeachingDerivationPersistence } from "./persistence.js";

function instructionView(promptBlock: string) {
  return async ({
    subject,
  }: SystemViewRequest): Promise<ContextEnvelope | null> => ({
    ownerCapabilityId: TEACHING_DERIVATION_CAPABILITY_ID,
    ownerCapabilityVersion: TEACHING_DERIVATION_CAPABILITY_VERSION,
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

export function createTeachingDerivationCapability() {
  return defineLearningSystemCapability({
    id: TEACHING_DERIVATION_CAPABILITY_ID,
    version: TEACHING_DERIVATION_CAPABILITY_VERSION,
    kind: "learning_system",
    views: {
      [TEACHING_DERIVATION_VIEW_KEYS.authoringInstruction]: instructionView(
        TEACHING_DERIVATION_AUTHORING_INSTRUCTION,
      ),
    },
    toolSets: [
      capabilityToolSetFromTools({
        key: TEACHING_DERIVATION_TOOL_SET,
        ownerCapabilityId: TEACHING_DERIVATION_CAPABILITY_ID,
        ownerCapabilityVersion: TEACHING_DERIVATION_CAPABILITY_VERSION,
        description:
          "Allowlisted tools for inspecting, committing, and finishing a teaching derivation run.",
        requiredScopes: ["user", "thread"],
        tools: createTeachingDerivationTools(),
      }),
    ],
  });
}
