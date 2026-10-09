import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmObservabilityRepository } from "./observability.repository.ts";

describe("observability repository", () => {
  it("normalizes SQLite millisecond timestamps instead of showing 1970", async () => {
    const firstSeenAt = 1_786_368_020_099;
    const lastSeenAt = 1_786_525_548_092;
    const execute = jest.fn().mockResolvedValue([
      {
        id: "error-1",
        createdAt: firstSeenAt,
        updatedAt: lastSeenAt,
        fingerprint: "fingerprint",
        source: "api",
        service: "desktop-local",
        errorName: null,
        errorCode: null,
        message: "HTTP 500 response",
        stack: null,
        statusCode: 500,
        method: "GET",
        route: "/api/goals/:id",
        operation: null,
        firstSeenAt,
        lastSeenAt,
        occurrenceCount: 1,
      },
    ]);
    const manager = {
      getConnection: () => ({ execute }),
      getTransactionContext: () => undefined,
      config: { getSchema: () => undefined },
      schema: undefined,
    } as unknown as EntityManager;

    const [group] = await new MikroOrmObservabilityRepository(
      manager,
    ).listBackendErrors({
      since: new Date(0),
      limit: 20,
    });

    expect(group?.firstSeenAt.getTime()).toBe(firstSeenAt);
    expect(group?.lastSeenAt.getTime()).toBe(lastSeenAt);
  });
});
