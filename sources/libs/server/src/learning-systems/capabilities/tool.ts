import { defineLearningSystemCapability } from "../define-capability.js";

export const TOOL_CAPABILITY_ID = "tool" as const;
export const TOOL_CAPABILITY_VERSION = "1.0.0" as const;

/** Platform marker for the sole executable model-tool gateway. */
export function createToolCapability() {
  return defineLearningSystemCapability({
    id: TOOL_CAPABILITY_ID,
    version: TOOL_CAPABILITY_VERSION,
    kind: "tool_capability",
  });
}
