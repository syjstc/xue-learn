export const FORMAL_DERIVATION_CAPABILITY_ID = "formal-derivation" as const;
export const FORMAL_DERIVATION_CAPABILITY_VERSION = "1.0.0" as const;
export const FORMAL_DERIVATION_TOOL_SET =
  "formal_derivation_authoring" as const;
export const FORMAL_DERIVATION_EXPANSION_TOOL_SET =
  "formal_derivation_expansion" as const;
export const FORMAL_DERIVATION_OPERATION =
  "admin.formal_derivation.author" as const;
export const UNIT_FORMAL_DERIVATION_OPERATION =
  "unit.formal_derivation.author" as const;
export const FORMAL_DERIVATION_EXPANSION_OPERATION =
  "admin.formal_derivation.expand" as const;
export const FORMAL_DERIVATION_PROMPT_VERSION =
  "formal-derivation-authoring.v16" as const;
export const FORMAL_DERIVATION_EXPANSION_PROMPT_VERSION =
  "formal-derivation-expansion.v7" as const;

export const FORMAL_DERIVATION_VIEW_KEYS = Object.freeze({
  authoringInstruction: "instruction.formal_derivation.authoring.v2",
  expansionInstruction: "instruction.formal_derivation.expansion.v2",
});
