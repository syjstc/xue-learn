import type { ModuleStructureDraftStage } from "../../../domain/src/index.js";

const IN_FLIGHT_MODULE_STRUCTURE_DRAFT_STATUSES = new Set<ModuleStructureDraftStage>(
  [
    "queued",
    "researching",
    "authoring",
    "validating",
    "repairing",
    "publishing",
  ],
);

type DraftStatusRow = Readonly<{ status: ModuleStructureDraftStage }>;

export function moduleStructureDraftsAreSettled(
  rows: readonly DraftStatusRow[],
): boolean {
  return (
    rows.length > 0 &&
    rows.every(
      (row) => !IN_FLIGHT_MODULE_STRUCTURE_DRAFT_STATUSES.has(row.status),
    )
  );
}

/** True when every draft finished and at least one failed, so learner Retry can requeue only those modules. */
export function moduleStructureDraftsNeedAttention(
  rows: readonly DraftStatusRow[],
): boolean {
  return (
    moduleStructureDraftsAreSettled(rows) &&
    rows.some((row) => row.status === "failed")
  );
}

export function moduleStructureDraftsReadyForAudit(
  rows: readonly DraftStatusRow[],
): boolean {
  return (
    rows.length > 0 &&
    rows.every((row) =>
      ["ready_for_audit", "ready"].includes(row.status),
    ) &&
    rows.some((row) => row.status === "ready_for_audit")
  );
}

type PublicationRow = Readonly<{
  status: ModuleStructureDraftStage;
  publishedAt?: Date | null;
}>;

/** Drafts that still need sequential publication, including crashed `publishing` rows. */
export function draftsNeedingPublication<T extends PublicationRow>(
  rows: readonly T[],
): T[] {
  return rows.filter(
    (row) =>
      row.status === "ready_for_audit" ||
      (row.status === "publishing" && !row.publishedAt),
  );
}
