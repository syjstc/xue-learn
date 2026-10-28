import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmGlobalGenerationSettingsRepository } from "./global-generation-settings.repository.ts";

describe("global generation settings reference repository", () => {
  it("supplies timestamps when creating the singleton row", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const manager = {
      schema: "tenant_a",
      getTransactionContext: () => undefined,
      getConnection: () => ({
        execute: async (sql: string, params: readonly unknown[] = []) => {
          calls.push({ sql, params });
          return calls.length === 2
            ? [
                {
                  imageProvider: "none",
                  searchEnabled: true,
                  searchProvider: "tavily",
                  chatAudioProvider: "minimax",
                  openaiBaseUrl: "official",
                  contentVerificationMode: "off",
                  contentVerificationProvider: "deepseek",
                  contentVerificationModel: "deepseek-flash",
                  disabledMaterialComponentTypes: [],
                  updatedAt: 1_786_320_000_000,
                  updatedByUserId: null,
                },
              ]
            : [];
        },
      }),
    } as unknown as EntityManager;

    const settings = await new MikroOrmGlobalGenerationSettingsRepository(
      manager,
    ).get();

    expect(calls[0]).toMatchObject({
      sql: expect.stringContaining('"id", "createdAt", "updatedAt"'),
      params: ["global", expect.any(Date), expect.any(Date)],
    });
    expect(calls[0].params[1]).toEqual(calls[0].params[2]);
    expect(settings.updatedAt.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });
});
