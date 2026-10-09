import type { EntityManager } from "@mikro-orm/core";
import {
  BASE_CAPABILITY_VIEW_KEYS,
  createBaseGenerationCapability,
} from "@xue-learn/core/source/libs/server/src/learning-systems/capabilities/base.ts";
import { createLearningSystemPersistenceClient } from "./learning-system-persistence-client.ts";

describe("createLearningSystemPersistenceClient", () => {
  it("normalizes SQLite epoch-millisecond timestamps", async () => {
    const execute = jest.fn(async () => [
      {
        id: "global",
        deepPlanningResearchConcurrency: "3",
        searchEnabled: 1,
        searchProvider: "tavily",
        updatedAt: 1_786_406_792_091,
      },
    ]);
    const em = {
      getConnection: () => ({ execute }),
      getTransactionContext: () => undefined,
    } as unknown as EntityManager;

    const persistence = createLearningSystemPersistenceClient(em);
    const settings = await persistence.globalGenerationSettings.findUnique({
      where: { id: "global" },
    });

    expect(settings.updatedAt).toEqual(new Date(1_786_406_792_091));
    expect(settings.updatedAt.toISOString()).toBe("2026-08-11T00:06:32.091Z");
    expect(settings.deepPlanningResearchConcurrency).toBe(3);
    expect(settings.searchEnabled).toBe(true);

    const capability = createBaseGenerationCapability({ persistence });
    const view = await capability.getView?.({
      key: BASE_CAPABILITY_VIEW_KEYS.generationPolicy,
      subject: {},
    });
    expect(view?.freshness.asOf).toBe("1970-01-01T00:00:00.000Z");
    expect((view?.data as { promptBlock?: string }).promptBlock).toContain(
      "Server generation policy (immutable)",
    );
  });

  it("normalizes SQLite false values on stored generation settings", async () => {
    const execute = jest.fn(async () => [
      {
        id: "global",
        searchEnabled: 0,
        searchProvider: "anysearch",
        updatedAt: "1786406792091",
      },
    ]);
    const em = {
      getConnection: () => ({ execute }),
      getTransactionContext: () => undefined,
    } as unknown as EntityManager;
    const persistence = createLearningSystemPersistenceClient(em);
    const settings = await persistence.globalGenerationSettings.findUnique({
      where: { id: "global" },
    });

    expect(settings.searchEnabled).toBe(false);
  });
});

describe("prior teaching persistence", () => {
  it("scopes ready excerpts to the owner and strictly preceding module/lesson order", async () => {
    const execute = jest.fn(async (_sql: string, _params: unknown[]) => [
      {
        title: "导数",
        blocks: '[{"type":"paragraph","text":"变化率"}]',
        keyTakeaways: '["瞬时变化率"]',
        contentRevision: 4,
      },
    ]);
    const em = {
      getConnection: () => ({ execute }),
      getTransactionContext: () => undefined,
    } as unknown as EntityManager;
    const result = await createLearningSystemPersistenceClient(
      em,
    ).priorTeaching!.findMany({ userId: "owner", unitId: "current" });
    const sql = execute.mock.calls[0]?.[0] as unknown as string;
    expect(sql).toContain('g."userId" = ?');
    expect(sql).toContain('p."orderIndex" < current_unit."orderIndex"');
    expect(sql).toContain('pm."orderIndex" < current_module."orderIndex"');
    expect(sql).toContain("ps.\"generationStatus\" = 'ready'");
    expect(result[0]?.blocks).toEqual([{ type: "paragraph", text: "变化率" }]);
  });
});
