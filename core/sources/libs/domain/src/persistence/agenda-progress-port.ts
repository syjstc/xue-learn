export interface AgendaProgressRepository {
  completeUnitItems(input: {
    userId: string;
    planningDate: string;
    unitId: string;
    itemType?: "new_learning" | "review";
    completedAt: Date;
  }): Promise<number>;
}
