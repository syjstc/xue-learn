import { hasValidSqPreview } from "./sq-preview.js";
import { isLearnableUnitKind } from "./unit-tree.js";
import { parseJson } from "../utils.js";

/** Whether structured lesson content (SQ survey + reading material) has been generated. */
export type UnitContentGenStatus = {
  hasSurvey: boolean;
  hasMaterial: boolean;
};

type UnitContentRow = {
  unitKind: string;
  sessionState?: { sq3rData: string; graphState?: string } | null;
  learningMaterial?: { sections: string; introduction: string } | null;
};

export function hasLearningMaterial(
  row: { sections: string; introduction: string } | null | undefined
): boolean {
  if (!row) return false;
  const sections = parseJson<unknown>(row.sections, []);
  if (Array.isArray(sections) && sections.length > 0) return true;
  return row.introduction.trim().length > 0;
}

export function deriveUnitContentGenStatus(
  unit: UnitContentRow
): UnitContentGenStatus | null {
  if (!isLearnableUnitKind(unit.unitKind)) return null;
  return {
    hasSurvey: hasValidSqPreview(unit.sessionState?.sq3rData),
    hasMaterial: hasLearningMaterial(unit.learningMaterial),
  };
}

export function buildUnitContentGenById(
  units: (UnitContentRow & { id: string })[]
): Map<string, UnitContentGenStatus> {
  const map = new Map<string, UnitContentGenStatus>();
  for (const unit of units) {
    const status = deriveUnitContentGenStatus(unit);
    if (status) map.set(unit.id, status);
  }
  return map;
}
