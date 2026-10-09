import type {
  DomainEvent,
  DomainEventType,
  LearningSystemSubject,
} from "./types.js";

export type JsonPrimitive = boolean | number | string | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export type DomainEventPublishInput<TPayload extends JsonObject = JsonObject> =
  {
    type: DomainEventType;
    schemaVersion?: number;
    subject?: LearningSystemSubject;
    payload: TPayload;
    occurredAt?: Date;
    idempotencyKey?: string;
  };

type DomainEventOutboxCreateData = {
  type: string;
  schemaVersion: number;
  idempotencyKey: string | null;
  userId: string | null;
  goalId: string | null;
  unitId: string | null;
  threadId: string | null;
  payload: JsonObject;
  occurredAt: Date;
};

type DomainEventDeliveryCreateData = {
  eventId: string;
  subscriberId: string;
};

export type DomainEventPublisherClient = {
  domainEventOutbox: {
    create(args: {
      data: DomainEventOutboxCreateData;
      select: { id: true };
    }): Promise<{ id: string }>;
    upsert(args: {
      where: { idempotencyKey: string };
      create: DomainEventOutboxCreateData;
      update: Record<string, never>;
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

export type DomainEventFanoutClient = {
  domainEventDelivery: {
    createMany(args: {
      data: DomainEventDeliveryCreateData[];
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };
};

export type DomainEventSubscriberRegistration = {
  subscriberId: string;
  eventTypes: readonly DomainEventType[];
};

export type DomainEventDeliveryStatus =
  "pending" | "processing" | "delivered" | "dead_lettered";

export type DomainEventRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_DOMAIN_EVENT_RETRY_POLICY: DomainEventRetryPolicy = {
  maxAttempts: 8,
  baseDelayMs: 5_000,
  maxDelayMs: 15 * 60_000,
};

export type DomainEventDeliveryClaimUpdate = {
  status: "processing";
  attempts: { increment: 1 };
  processingStartedAt: Date;
  lastAttemptAt: Date;
  nextAttemptAt: Date | null;
};

export type DomainEventDeliverySettlement = {
  status: "pending" | "delivered" | "dead_lettered";
  processingStartedAt: Date | null;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
  deadLetteredAt: Date | null;
  lastError: string | null;
};

function requiredName(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty`);
  return normalized;
}

function optionalId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function validateRetryPolicy(
  policy: DomainEventRetryPolicy,
): DomainEventRetryPolicy {
  positiveInteger(policy.maxAttempts, "maxAttempts");
  positiveInteger(policy.baseDelayMs, "baseDelayMs");
  positiveInteger(policy.maxDelayMs, "maxDelayMs");
  if (policy.maxDelayMs < policy.baseDelayMs) {
    throw new Error("maxDelayMs must be greater than or equal to baseDelayMs");
  }
  return policy;
}

/**
 * Append a completed domain fact using either the process client or an existing
 * transaction client. Subscriber deliveries are intentionally created by the
 * separate fan-out step so the publisher does not depend on registry state.
 */
export async function publishDomainEvent<TPayload extends JsonObject>(
  client: DomainEventPublisherClient,
  input: DomainEventPublishInput<TPayload>,
): Promise<DomainEvent<TPayload>> {
  const type = requiredName(input.type, "event type");
  const schemaVersion = positiveInteger(
    input.schemaVersion ?? 1,
    "schemaVersion",
  );
  const occurredAt = input.occurredAt ?? new Date();
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new Error("occurredAt must be a valid date");
  }

  const subject: LearningSystemSubject = {
    ...(optionalId(input.subject?.userId)
      ? { userId: optionalId(input.subject?.userId) ?? undefined }
      : {}),
    ...(optionalId(input.subject?.goalId)
      ? { goalId: optionalId(input.subject?.goalId) ?? undefined }
      : {}),
    ...(optionalId(input.subject?.moduleId)
      ? { moduleId: optionalId(input.subject?.moduleId) ?? undefined }
      : {}),
    ...(optionalId(input.subject?.unitId)
      ? { unitId: optionalId(input.subject?.unitId) ?? undefined }
      : {}),
    ...(optionalId(input.subject?.threadId)
      ? { threadId: optionalId(input.subject?.threadId) ?? undefined }
      : {}),
  };

  const idempotencyKey = input.idempotencyKey
    ? requiredName(input.idempotencyKey, "idempotencyKey")
    : null;
  const data: DomainEventOutboxCreateData = {
    type,
    schemaVersion,
    idempotencyKey,
    userId: subject.userId ?? null,
    goalId: subject.goalId ?? null,
    unitId: subject.unitId ?? null,
    threadId: subject.threadId ?? null,
    payload: input.payload,
    occurredAt,
  };
  const stored = idempotencyKey
    ? await client.domainEventOutbox.upsert({
        where: { idempotencyKey },
        create: data,
        update: {},
        select: { id: true },
      })
    : await client.domainEventOutbox.create({
        data,
        select: { id: true },
      });

  return {
    id: stored.id,
    type,
    schemaVersion,
    subject,
    occurredAt: occurredAt.toISOString(),
    payload: input.payload,
  };
}

/** Select exact event subscribers and deduplicate registrations by owner ID. */
export function selectDomainEventSubscribers(
  type: DomainEventType,
  registrations: readonly DomainEventSubscriberRegistration[],
): string[] {
  const normalizedType = requiredName(type, "event type");
  const subscriberIds = new Set<string>();
  for (const registration of registrations) {
    if (!registration.eventTypes.includes(normalizedType)) continue;
    subscriberIds.add(requiredName(registration.subscriberId, "subscriberId"));
  }
  return [...subscriberIds].sort();
}

/**
 * Materialize missing per-subscriber deliveries. The database uniqueness
 * constraint plus skipDuplicates makes retries and concurrent dispatch safe.
 */
export async function fanOutDomainEvent(
  client: DomainEventFanoutClient,
  event: Pick<DomainEvent, "id" | "type">,
  registrations: readonly DomainEventSubscriberRegistration[],
): Promise<{ selected: number; created: number }> {
  const eventId = requiredName(event.id, "eventId");
  const subscriberIds = selectDomainEventSubscribers(event.type, registrations);
  if (subscriberIds.length === 0) return { selected: 0, created: 0 };

  const result = await client.domainEventDelivery.createMany({
    data: subscriberIds.map((subscriberId) => ({
      eventId,
      subscriberId,
    })),
    skipDuplicates: true,
  });
  return { selected: subscriberIds.length, created: result.count };
}

export function buildDomainEventDeliveryClaim(
  now = new Date(),
): DomainEventDeliveryClaimUpdate {
  if (!Number.isFinite(now.getTime())) throw new Error("now must be valid");
  return {
    status: "processing",
    attempts: { increment: 1 },
    processingStartedAt: now,
    lastAttemptAt: now,
    nextAttemptAt: null,
  };
}

export function domainEventRetryDelayMs(
  attempts: number,
  policy: DomainEventRetryPolicy = DEFAULT_DOMAIN_EVENT_RETRY_POLICY,
): number {
  positiveInteger(attempts, "attempts");
  validateRetryPolicy(policy);
  const exponent = Math.min(attempts - 1, 30);
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
}

export function settleDomainEventDeliverySuccess(
  now = new Date(),
): DomainEventDeliverySettlement {
  if (!Number.isFinite(now.getTime())) throw new Error("now must be valid");
  return {
    status: "delivered",
    processingStartedAt: null,
    nextAttemptAt: null,
    deliveredAt: now,
    deadLetteredAt: null,
    lastError: null,
  };
}

export function settleDomainEventDeliveryFailure(params: {
  attempts: number;
  error: unknown;
  now?: Date;
  policy?: DomainEventRetryPolicy;
}): DomainEventDeliverySettlement {
  const attempts = positiveInteger(params.attempts, "attempts");
  const now = params.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("now must be valid");
  const policy = validateRetryPolicy(
    params.policy ?? DEFAULT_DOMAIN_EVENT_RETRY_POLICY,
  );
  const message =
    params.error instanceof Error
      ? params.error.message
      : String(params.error ?? "Unknown domain-event delivery error");
  const lastError = message.slice(0, 4_000);

  if (attempts >= policy.maxAttempts) {
    return {
      status: "dead_lettered",
      processingStartedAt: null,
      nextAttemptAt: null,
      deliveredAt: null,
      deadLetteredAt: now,
      lastError,
    };
  }

  const delayMs = domainEventRetryDelayMs(attempts, policy);
  return {
    status: "pending",
    processingStartedAt: null,
    nextAttemptAt: new Date(now.getTime() + delayMs),
    deliveredAt: null,
    deadLetteredAt: null,
    lastError,
  };
}
