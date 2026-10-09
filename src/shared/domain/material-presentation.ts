import { canUseBrowserPersistentStorage } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

export const MATERIAL_PRESENTATION_STORAGE_PREFIX =
  "xue-learn.materialPresentation";

export interface MaterialPresentationState {
  slideIndex: number;
  /** User reached the last slide at least once. */
  hasCompletedSlides: boolean;
  /** Per-section block reveal progress within the main course (sectionIndex → step). */
  sectionSteps?: Record<number, number>;
  /** SQLite-backed cursor for the chat-style material in each authored section. */
  sectionCursors?: Record<string, { contentRevision: number; cursor: number }>;
}

export const DEFAULT_MATERIAL_PRESENTATION: MaterialPresentationState = {
  slideIndex: 0,
  hasCompletedSlides: false,
  sectionSteps: {},
  sectionCursors: {},
};

function parseSectionSteps(raw: unknown): Record<number, number> {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<number, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const sectionIndex = Number(key);
    if (
      Number.isInteger(sectionIndex) &&
      sectionIndex >= 0 &&
      typeof value === "number" &&
      value >= 0
    ) {
      result[sectionIndex] = value;
    }
  }
  return result;
}

export function materialPresentationStorageKey(unitId: string): string {
  return `${MATERIAL_PRESENTATION_STORAGE_PREFIX}:${unitId}`;
}

export function readMaterialPresentation(
  unitId: string,
): MaterialPresentationState {
  if (typeof window === "undefined") return DEFAULT_MATERIAL_PRESENTATION;
  if (!canUseBrowserPersistentStorage()) return DEFAULT_MATERIAL_PRESENTATION;
  try {
    const raw = localStorage.getItem(materialPresentationStorageKey(unitId));
    if (!raw) return DEFAULT_MATERIAL_PRESENTATION;
    const parsed = JSON.parse(raw) as Partial<
      MaterialPresentationState & { viewMode?: string }
    >;
    return {
      slideIndex:
        typeof parsed.slideIndex === "number" && parsed.slideIndex >= 0
          ? parsed.slideIndex
          : 0,
      hasCompletedSlides: Boolean(parsed.hasCompletedSlides),
      sectionSteps: parseSectionSteps(parsed.sectionSteps),
      sectionCursors: {},
    };
  } catch {
    return DEFAULT_MATERIAL_PRESENTATION;
  }
}

export function writeMaterialPresentation(
  unitId: string,
  state: MaterialPresentationState,
): void {
  if (!canUseBrowserPersistentStorage()) return;
  localStorage.setItem(
    materialPresentationStorageKey(unitId),
    JSON.stringify(state),
  );
}

/** Clear slide and per-section reading progress. */
export function clearMaterialLearningProgress(unitId: string): void {
  if (typeof window === "undefined") return;
  const current = readMaterialPresentation(unitId);
  writeMaterialPresentation(unitId, {
    slideIndex: 0,
    hasCompletedSlides: false,
    sectionSteps: {},
    sectionCursors: {},
  });
}
