export type UnitSessionStateRecord = Readonly<{
  id: string;
  unitId: string;
  currentStep: string;
  structuredSubStep: string;
  graphState: string;
  sq3rData: string;
  socraticTurn: number;
  cumulativeActiveSeconds: number;
  updatedAt: Date;
}>;

export type UpdateOwnedUnitSessionInput = Readonly<{
  userId: string;
  unitId: string;
  patch: Partial<
    Pick<
      UnitSessionStateRecord,
      | "currentStep"
      | "structuredSubStep"
      | "graphState"
      | "sq3rData"
      | "socraticTurn"
      | "cumulativeActiveSeconds"
    >
  >;
}>;

/** Session state is learner-owned through the unit's goal; orchestration remains above this port. */
export interface UnitSessionStateRepository {
  getOrCreateOwned(
    userId: string,
    unitId: string,
  ): Promise<UnitSessionStateRecord | null>;
  updateOwned(
    input: UpdateOwnedUnitSessionInput,
  ): Promise<UnitSessionStateRecord | null>;
}
