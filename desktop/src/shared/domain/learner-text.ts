export const LEARNER_NAME_PLACEHOLDER = "{{learnerName}}";

/** Prefer nickname, then login username; undefined means the generic “你” fallback. */
export function resolveLearnerDisplayName(
  nickname?: string | null,
  accountName?: string | null,
): string | undefined {
  const preferred = nickname?.trim() || accountName?.trim();
  return preferred || undefined;
}

/** Resolve learner-specific copy at presentation time so saved content stays reusable. */
export function personalizeLearnerText(
  text: string,
  learnerName?: string,
): string {
  return text.split(LEARNER_NAME_PLACEHOLDER).join(learnerName?.trim() || "你");
}

/** Compatibility for introductions generated before the placeholder contract. */
export function personalizeLegacyLearnerIntroduction(
  text: string,
  learnerName?: string,
  accountName?: string | null,
): string {
  const currentName = learnerName?.trim();
  const legacyName = accountName?.trim();
  if (!currentName || !legacyName || currentName === legacyName) return text;
  return text.split(legacyName).join(currentName);
}

/**
 * Learning material contains prose in several nested block shapes. Replace the
 * reserved learner-name token without coupling this utility to every schema
 * variant, while leaving the persisted object untouched.
 */
export function personalizeLearnerContent<T>(
  value: T,
  learnerName?: string,
): T {
  if (typeof value === "string") {
    return personalizeLearnerText(value, learnerName) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      personalizeLearnerContent(item, learnerName),
    ) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        personalizeLearnerContent(child, learnerName),
      ]),
    ) as T;
  }
  return value;
}
