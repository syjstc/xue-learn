export type InvalidateCognitiveModelInput = Readonly<{
  goalId: string;
  reason?: string;
  enqueue?: boolean;
  force?: boolean;
}>;

export type InvalidateCognitiveModelResult = Readonly<{
  goalId: string;
  inputHash: string;
  changed: boolean;
  eventId: string | null;
}>;

/** Owns the atomic curriculum fingerprint fence and optional skeleton enqueue. */
export interface CognitiveModelInvalidationRepository {
  invalidate(
    input: InvalidateCognitiveModelInput,
  ): Promise<InvalidateCognitiveModelResult>;
}
