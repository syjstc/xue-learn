import { isUnitLearningDone } from "@xue-learn/core/domain";
import type { UnitStatus } from "./types.ts";
import {
  getCurrentUiLocale,
  translateForLocale,
  type TranslationKey,
} from "@xue-learn/core/i18n";

export { isUnitLearningDone };

export function parsePrereqs(json: string): string[] {
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

export function normalizeUnitStatus(status: string): UnitStatus {
  return status as UnitStatus;
}

export function scoreToWeakTags(score: number, threshold = 0.7): boolean {
  return score < threshold;
}

export function statusLabel(status: UnitStatus, zh?: boolean): string {
  const active = getCurrentUiLocale();
  const locale =
    zh === undefined
      ? active
      : zh
        ? active === "zh-Hant"
          ? "zh-Hant"
          : "zh-Hans"
        : "en";
  const key: TranslationKey = `desktop.unitStatus.${status}`;
  return translateForLocale(locale, key);
}
