export type AgendaProjectionItemRecord = Readonly<{
  id: string;
  goalId: string;
  unitId: string;
  sectionId: string | null;
  goalTitle: string;
  sectionTitle: string | null;
  itemType: string;
  plannedDate: string;
  estimatedMinutes: number;
  priority: number;
  explanation: string;
  explanationCode: string;
  completedAt: Date | null;
  reviewDueAt: Date | null;
  reviewCardId: string | null;
  cognitiveEntityIds: string;
  targetState: unknown;
  expectedEvidence: unknown;
  sortIndex: number;
}>;

export type AgendaProjectionUnitRecord = Readonly<{
  id: string;
  title: string;
  status: string;
  completedAt: Date | null;
  completionMethod: string | null;
}>;

export type AgendaRevisionProjection = Readonly<{
  id: string;
  capacityMinutes: number;
  capacityJson: string;
  generationSource: string;
  reason: string;
  items: readonly AgendaProjectionItemRecord[];
  units: readonly AgendaProjectionUnitRecord[];
}>;

export type AgendaItemExplanationRecord = Readonly<{
  id: string;
  explanation: string;
  explanationCode: string;
  itemType: string;
  plannedDate: string;
  priority: number;
}>;

export interface AgendaProjectionReadRepository {
  findDailyActiveSeconds(userId: string, localDate: string): Promise<number>;
  findActiveProjection(
    userId: string,
    planningDate?: string,
  ): Promise<AgendaRevisionProjection | null>;
  findActiveItemExplanation(
    userId: string,
    itemId: string,
  ): Promise<AgendaItemExplanationRecord | null>;
}
