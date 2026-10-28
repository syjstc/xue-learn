export type DerivationFormatChoice = "classic" | "teaching_v1";

export function resolveDerivationFormat(input: {
  regenerate?: boolean;
  locked?: string | null;
  hasClassicContent: boolean;
  hasTeachingContent: boolean;
}): DerivationFormatChoice {
  if (input.regenerate) return "teaching_v1";
  const locked = input.locked?.trim();
  if (locked === "teaching_v1" || input.hasTeachingContent) return "teaching_v1";
  // Continue stored runs in their original format; all new runs use teaching_v1.
  if (locked === "classic" || input.hasClassicContent) return "classic";
  return "teaching_v1";
}
