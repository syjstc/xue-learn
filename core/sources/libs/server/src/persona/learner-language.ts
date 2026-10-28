import type { LearningGoalRepository } from "../../../domain/src/index.js";
import {
  DEFAULT_BACKEND_LOCALE,
  getCurrentLocale,
} from "../../../common/src/i18n/backend-i18n.js";
import {
  resolveGoalContentLanguage,
  type ContentLanguageCode,
} from "../llm/content-language.js";

/** Resolve presentation language without relying on legacy learner memory. */
let configured: Pick<LearningGoalRepository, "listOwned"> | undefined;

export function configureLearnerLanguagePersistence(
  repository: Pick<LearningGoalRepository, "listOwned"> | undefined,
): void {
  configured = repository;
}

export async function resolveLearnerContentLanguage(
  userId: string,
): Promise<ContentLanguageCode> {
  if (!configured)
    throw new Error("Learner-language persistence is not configured");
  const goals = (await configured.listOwned(userId)).slice(0, 12);
  const counts = new Map<ContentLanguageCode, number>();
  for (const goal of goals) {
    const code = resolveGoalContentLanguage(goal.contentLanguage, goal.title);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0]?.[0];
  if (best) return best;
  const locale = getCurrentLocale();
  return locale === "zh-Hans" || locale === "zh-Hant" || locale === "en"
    ? locale
    : DEFAULT_BACKEND_LOCALE;
}
