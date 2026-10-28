import { parseLearningMaterial } from "../../graph/unit-session.js";
import type { LearningMaterialContent } from "../../llm/schemas.js";
import { parseOverviewUnitNote } from "../../goals/persist-overview-course.js";

export function serializeGoalOverviewUnit(unit: {
  id: string;
  moduleId?: string | null;
  title: string;
  contentSummary: string;
  note: string;
  orderIndex: number;
  status: string;
  learningMaterial: {
    introduction: string;
    sections: string;
    keyTakeaways: string;
  } | null;
}) {
  const meta = parseOverviewUnitNote(unit.note);
  const material: LearningMaterialContent | null = unit.learningMaterial
    ? parseLearningMaterial(unit.learningMaterial)
    : null;
  const completedAt =
    meta.completedAt ??
    (unit.status === "completed" ? new Date().toISOString() : null);
  return {
    id: unit.id,
    moduleId: unit.moduleId ?? null,
    title: unit.title,
    summary: unit.contentSummary,
    keyConcepts: meta.keyConcepts,
    branchIncludes: meta.branchIncludes,
    checkQuestion: meta.checkQuestion,
    material,
    orderIndex: unit.orderIndex,
    completedAt,
  };
}

export function serializeBranchUnit(unit: {
  id: string;
  moduleId?: string | null;
  title: string;
  status: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  prerequisites: string;
  contentSummary: string;
  note: string;
  mapOrigin: string;
  mapEdited: boolean;
  linkedGoalId: string | null;
  completionMethod?: string | null;
  completionAttemptId?: string | null;
  completedAt?: Date | null;
}) {
  return {
    id: unit.id,
    moduleId: unit.moduleId ?? null,
    title: unit.title,
    status: unit.status,
    unitKind: unit.unitKind,
    parentUnitId: unit.parentUnitId,
    orderIndex: unit.orderIndex,
    prerequisites: unit.prerequisites,
    contentSummary: unit.contentSummary,
    note: unit.note,
    mapOrigin: unit.mapOrigin,
    mapEdited: unit.mapEdited,
    linkedGoalId: unit.linkedGoalId,
    completionMethod: unit.completionMethod ?? null,
    completionAttemptId: unit.completionAttemptId ?? null,
    completedAt: unit.completedAt?.toISOString() ?? null,
  };
}
