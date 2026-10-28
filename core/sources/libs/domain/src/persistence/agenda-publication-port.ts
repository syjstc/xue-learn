export type PublishAgendaItemInput = Readonly<{
  id: string;
  goalId: string;
  unitId: string;
  sectionId: string | null;
  itemType: "new_learning" | "review";
  plannedDate: string;
  estimatedMinutes: number;
  priority: number;
  explanation: string;
  explanationCode: string;
  reviewDueAt: Date | null;
  reviewCardId: string | null;
  cognitiveEntityIdsJson: string;
  targetStateJson: string;
  expectedEvidenceJson: string;
  sortIndex: number;
}>;

export type PublishAgendaRevisionInput = Readonly<{
  revisionId: string;
  userId: string;
  planningDate: string;
  timezone: string;
  capacityMinutes: number;
  capacityJson: string;
  reason: string;
  generationSource: "deterministic" | "llm_refined";
  contentHash: string;
  activatedAt: Date;
  items: readonly PublishAgendaItemInput[];
}>;

/** Atomic supersede/publish/clear-invalidation boundary for Agenda revisions. */
export interface AgendaPublicationRepository {
  publish(input: PublishAgendaRevisionInput): Promise<void>;
}
