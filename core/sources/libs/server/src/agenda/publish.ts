import { randomUUID } from "node:crypto";
import type { AgendaPublicationRepository } from "../../../domain/src/index.js";
import type {
  DeterministicAgenda,
  AgendaGenerationSource,
  AgendaRefreshReason,
} from "./types.js";

let configuredAgendaPublication: AgendaPublicationRepository | undefined;

export function configureAgendaPublicationPersistence(
  repository: AgendaPublicationRepository | undefined,
): void {
  configuredAgendaPublication = repository;
}

function persistence(): AgendaPublicationRepository {
  if (!configuredAgendaPublication)
    throw new Error("Agenda publication persistence is not configured");
  return configuredAgendaPublication;
}

export type PublishedAgenda = {
  revisionId: string;
  planningDate: string;
  timezone: string;
  capacityMinutes: number;
  capacityJson: string;
  generationSource: AgendaGenerationSource;
  contentHash: string;
  reason: AgendaRefreshReason;
  itemCount: number;
};

export async function publishAgendaRevision(params: {
  userId: string;
  agenda: DeterministicAgenda;
  generationSource: AgendaGenerationSource;
  reason: AgendaRefreshReason;
  client?: unknown;
}): Promise<PublishedAgenda> {
  const { userId, agenda, generationSource, reason } = params;
  const capacityJson = JSON.stringify({
    ...agenda.capacity,
    capacityByDate: agenda.capacityByDate,
  });

  const revisionId = randomUUID();
  await persistence().publish({
    revisionId,
    userId,
    planningDate: agenda.planningDate,
    timezone: agenda.timezone,
    capacityMinutes: agenda.capacityMinutes,
    capacityJson,
    generationSource,
    reason,
    contentHash: agenda.contentHash,
    activatedAt: new Date(),
    items: agenda.items.map((item) => ({
      id: randomUUID(),
      goalId: item.goalId,
      unitId: item.unitId,
      sectionId: item.sectionId ?? null,
      itemType: item.itemType,
      plannedDate: item.plannedDate,
      estimatedMinutes: item.estimatedMinutes,
      priority: item.priority,
      explanation: item.explanation,
      explanationCode: item.explanationCode,
      reviewDueAt: item.reviewDueAt ? new Date(item.reviewDueAt) : null,
      reviewCardId: item.reviewCardId ?? null,
      cognitiveEntityIdsJson: JSON.stringify(item.cognitiveEntityIds ?? []),
      targetStateJson: JSON.stringify(item.targetState ?? {}),
      expectedEvidenceJson: JSON.stringify(item.expectedEvidence ?? {}),
      sortIndex: item.sortIndex,
    })),
  });
  return {
    revisionId,
    planningDate: agenda.planningDate,
    timezone: agenda.timezone,
    capacityMinutes: agenda.capacityMinutes,
    capacityJson,
    generationSource,
    contentHash: agenda.contentHash,
    reason,
    itemCount: agenda.items.length,
  };
}
