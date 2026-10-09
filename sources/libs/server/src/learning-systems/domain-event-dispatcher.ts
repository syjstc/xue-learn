import type { DomainEventDispatchRepository } from "../../../domain/src/index.js";
import {
  selectDomainEventSubscribers,
  settleDomainEventDeliveryFailure,
  settleDomainEventDeliverySuccess,
  type DomainEventSubscriberRegistration,
} from "./domain-events.js";
import { LearningSystemRegistry } from "./registry.js";
import type { DomainEvent } from "./types.js";

export type DomainEventDispatchResult = {
  fannedOutEvents: number;
  delivered: number;
  retried: number;
  deadLettered: number;
};

function subscriberRegistrations(
  registry: LearningSystemRegistry,
): DomainEventSubscriberRegistration[] {
  return registry
    .getCapabilities()
    .filter(
      (capability) =>
        capability.handleEvent &&
        (capability.manifest.subscribesToEvents?.length ?? 0) > 0,
    )
    .map((capability) => ({
      subscriberId: capability.manifest.id,
      eventTypes: capability.manifest.subscribesToEvents ?? [],
    }));
}

function toDomainEvent(row: {
  id: string;
  type: string;
  schemaVersion: number;
  userId: string | null;
  goalId: string | null;
  unitId: string | null;
  threadId: string | null;
  occurredAt: Date;
  payload: unknown;
}): DomainEvent {
  return {
    id: row.id,
    type: row.type,
    schemaVersion: row.schemaVersion,
    subject: {
      ...(row.userId ? { userId: row.userId } : {}),
      ...(row.goalId ? { goalId: row.goalId } : {}),
      ...(row.unitId ? { unitId: row.unitId } : {}),
      ...(row.threadId ? { threadId: row.threadId } : {}),
    },
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload,
  };
}

/**
 * Bounded, concurrency-safe dispatcher used by analytics-worker. Fan-out and
 * subscriber delivery are separate so one failed capability cannot block
 * another subscriber.
 */
export async function processDomainEventBatch(
  repository: DomainEventDispatchRepository,
  registry: LearningSystemRegistry,
  options: {
    fanoutLimit?: number;
    deliveryLimit?: number;
    processingTimeoutMs?: number;
    now?: Date;
  } = {},
): Promise<DomainEventDispatchResult> {
  const now = options.now ?? new Date();
  const fanoutLimit = Math.max(1, Math.min(options.fanoutLimit ?? 25, 100));
  const deliveryLimit = Math.max(1, Math.min(options.deliveryLimit ?? 25, 100));
  const processingTimeoutMs = Math.max(
    30_000,
    Math.min(options.processingTimeoutMs ?? 5 * 60_000, 60 * 60_000),
  );
  const staleProcessingBefore = new Date(now.getTime() - processingTimeoutMs);
  const registrations = subscriberRegistrations(registry);
  const pendingFanout = await repository.listPendingFanout(fanoutLimit);
  for (const event of pendingFanout) {
    await repository.fanOutAndMarkComplete({
      eventId: event.id,
      subscriberIds: selectDomainEventSubscribers(event.type, registrations),
      completedAt: now,
    });
  }

  const deliveries = await repository.claimDueDeliveries({
    limit: deliveryLimit,
    now,
    staleProcessingBefore,
  });
  let delivered = 0;
  let retried = 0;
  let deadLettered = 0;

  for (const delivery of deliveries) {
    const capability = registry.getCapability(delivery.subscriberId);
    const attempts = delivery.attempts;
    try {
      if (
        !capability?.handleEvent ||
        !capability.manifest.subscribesToEvents?.includes(delivery.event.type)
      ) {
        throw new Error(
          `Domain-event subscriber "${delivery.subscriberId}" is not registered for "${delivery.event.type}"`,
        );
      }
      await capability.handleEvent(toDomainEvent(delivery.event));
      await repository.settleDelivery({
        deliveryId: delivery.id,
        ...settleDomainEventDeliverySuccess(now),
      });
      delivered += 1;
    } catch (error) {
      const settlement = settleDomainEventDeliveryFailure({
        attempts,
        error,
        now,
      });
      await repository.settleDelivery({
        deliveryId: delivery.id,
        ...settlement,
      });
      if (settlement.status === "dead_lettered") deadLettered += 1;
      else retried += 1;
    }
  }

  return {
    fannedOutEvents: pendingFanout.length,
    delivered,
    retried,
    deadLettered,
  };
}
