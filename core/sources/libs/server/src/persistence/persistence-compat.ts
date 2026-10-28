/**
 * Temporary structural types for unbound compatibility helpers.
 * Hosted composition never supplies this surface; transaction-owned ports do.
 */
export type PersistenceClient = any;

export class Persistence {
  static sql(strings: TemplateStringsArray, ...values: unknown[]) {
    return { strings: [...strings], values };
  }
  static KnownRequestError = class extends Error { code = ""; };
}
export namespace Persistence {
  export type TransactionClient = any;
  export type InputJsonValue = any;
  export type JsonValue = any;
  export type Sql = any;
  export type LearningTaskWhereInput = any;
  export type FlashCardOrderByWithRelationInput = any;
  export type FlashCardWhereInput = any;
  export type LearningUnitWhereInput = any;
  export type TaskObservationGetPayload<T> = any;
  export type TaskObservationUncheckedCreateInput = any;
  export type EvidenceClaimGetPayload<T> = any;
  export type LearnerEntityStateGetPayload<T> = any;
  export type LearningTaskGetPayload<T> = any;
  export type KnownRequestError = Error & { code: string };
}
