import type { UnitLabRepository } from "../../../domain/src/index.js";
import { parseUnitLabDefinition } from "./schema.js";

export async function getUnitLabContent(
  repository: UnitLabRepository,
  userId: string,
  unitId: string,
) {
  const lab = await repository.findLabContent({ userId, unitId });
  if (!lab) return null;
  const definition =
    ["prepared", "ready"].includes(lab.status) && lab.definitionJson
      ? parseUnitLabDefinition(lab.definitionJson)
      : null;
  return {
    status: lab.status,
    recommended: lab.recommended,
    recommendation: lab.recommendation,
    revision: lab.revision,
    definition,
    generationError: lab.status === "failed" ? lab.generationError : "",
  };
}

export async function getUnitLabSession(
  repository: UnitLabRepository,
  userId: string,
  unitId: string,
) {
  const lab = await repository.findLabSession({ userId, unitId });
  if (!lab) {
    return { available: false, completedOnce: false, openedOnce: false };
  }
  return {
    available: lab.status === "ready" || lab.status === "prepared",
    status: lab.status,
    revision: lab.revision,
    completedOnce: lab.completedOnce,
    openedOnce: lab.openedOnce,
  };
}

export async function startUnitLab(
  repository: UnitLabRepository,
  userId: string,
  unitId: string,
) {
  await repository.markOpened({ userId, unitId });
  return {
    unitLab: await getUnitLabContent(repository, userId, unitId),
    unitLabSession: await getUnitLabSession(repository, userId, unitId),
  };
}

export async function completeUnitLab(
  repository: UnitLabRepository,
  userId: string,
  unitId: string,
) {
  await repository.markCompleted({ userId, unitId });
  return getUnitLabSession(repository, userId, unitId);
}

export async function unitLabCompletionOffered(
  repository: UnitLabRepository,
  userId: string,
  unitId: string,
): Promise<boolean> {
  const lab = await repository.findLabContent({ userId, unitId });
  if (!lab?.recommended) return false;
  const session = await getUnitLabSession(repository, userId, unitId);
  return !session.completedOnce;
}
