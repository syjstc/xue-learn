import { isLearnableUnitKind } from "@/shared/domain/unit-tree";
import { hasValidSqPreview } from "@/shared/domain/sq-preview";
import { parseJson } from "@xue-learn/core/utils";

/** Whether structured lesson content (SQ survey + reading material) has been generated. */
export type UnitContentGenStatus = {
  hasSurvey: boolean;
  hasMaterial: boolean;
};

type UnitContentRow = {
  unitKind: string;
  contentGen?: UnitContentGenStatus;
  contentStatus?: {
    hasMaterial?: boolean;
    hasSq?: boolean;
  };
  sessionState?: { sq3rData?: string; graphState?: string } | null;
  learningMaterial?:
    | { sections: string; introduction: string }
    | { hasContent: true }
    | null;
};

export function hasLearningMaterial(
  row:
    | { sections: string; introduction: string }
    | { hasContent: true }
    | null
    | undefined,
): boolean {
  if (!row) return false;
  if ("hasContent" in row) return row.hasContent === true;
  const sections = parseJson<unknown>(row.sections, []);
  if (Array.isArray(sections) && sections.length > 0) return true;
  return row.introduction.trim().length > 0;
}

export function deriveUnitContentGenStatus(
  unit: UnitContentRow
): UnitContentGenStatus | null {
  if (unit.contentGen) return unit.contentGen;
  if (!isLearnableUnitKind(unit.unitKind)) return null;
  if (unit.contentStatus) {
    return {
      hasSurvey: Boolean(unit.contentStatus.hasSq),
      hasMaterial: Boolean(unit.contentStatus.hasMaterial),
    };
  }
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
