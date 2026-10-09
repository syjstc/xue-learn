export type PendingDomainEvent = Readonly<{
  id: string;
  type: string;
}>;

export type ClaimedDomainEventDelivery = Readonly<{
  id: string;
  subscriberId: string;
  attempts: number;
  event: Readonly<{
    id: string;
    type: string;
    schemaVersion: number;
    userId: string | null;
    goalId: string | null;
    unitId: string | null;
    threadId: string | null;
    occurredAt: Date;
    payload: unknown;
  }>;
}>;

export type DomainEventDeliverySettlementInput = Readonly<{
  deliveryId: string;
  status: "pending" | "delivered" | "dead_lettered";
  processingStartedAt: Date | null;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  deadLetteredAt: Date | null;
  lastError: string | null;
}>;

/** Transaction-owning fan-out and delivery-lease boundary for the event worker. */
export interface DomainEventDispatchRepository {
  listPendingFanout(limit: number): Promise<readonly PendingDomainEvent[]>;
  fanOutAndMarkComplete(input: {
    eventId: string;
    subscriberIds: readonly string[];
    completedAt: Date;
  }): Promise<boolean>;
  claimDueDeliveries(input: {
    limit: number;
    now: Date;
    staleProcessingBefore: Date;
  }): Promise<readonly ClaimedDomainEventDelivery[]>;
  settleDelivery(input: DomainEventDeliverySettlementInput): Promise<boolean>;
}
