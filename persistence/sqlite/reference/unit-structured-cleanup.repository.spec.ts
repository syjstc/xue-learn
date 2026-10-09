import type { EntityManager } from "@mikro-orm/core";
import { MikroOrmUnitStructuredCleanupRepository } from "./unit-structured-cleanup.repository.ts";

function fakeManager() {
  const execute = jest.fn(async (sql: string) => {
    if (sql.includes('SELECT u."id"')) return [{ id: "unit-1" }];
    if (sql.includes("MainCourseSection")) return [{ id: "section-1" }];
    if (sql.includes('SELECT "graphState"')) return [{ graphState: "{}" }];
    return [];
  });
  return {
    manager: {
      getConnection: () => ({ execute }),
      getTransactionContext: () => undefined,
    } as unknown as EntityManager,
    execute,
  };
}

describe("unit structured cleanup repository", () => {
  it("clears the persisted Survey preview when cleanup starts from SQ", async () => {
    const fake = fakeManager();
    const repository = new MikroOrmUnitStructuredCleanupRepository(fake.manager);

    await repository.clear({
      userId: "user-1",
      unitId: "unit-1",
      from: "sq",
    });

    const sql = fake.execute.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => statement.includes(`DELETE FROM "UnitSectionMaterial"`))).toBe(
      true,
    );
    expect(
      sql.some((statement) =>
        statement.includes(`DELETE FROM "UnitSectionTeachingDerivation"`),
      ),
    ).toBe(true);
    expect(
      sql.some((statement) => statement.includes(`DELETE FROM "TeachingDerivationRun"`)),
    ).toBe(true);
    expect(
      sql.some((statement) =>
        statement.includes(`DELETE FROM "LessonPerformanceProject"`),
      ),
    ).toBe(false);
    expect(sql.some((statement) => statement.includes(`DELETE FROM "UnitSection"`))).toBe(
      true,
    );
    expect(fake.execute).toHaveBeenCalledWith(
      expect.stringContaining(
        `UPDATE "UnitSessionState" SET "sq3rData" = ''`,
      ),
      ["unit-1"],
      undefined,
      undefined,
    );
  });

  it("preserves the Survey preview when regenerating material", async () => {
    const fake = fakeManager();
    const repository = new MikroOrmUnitStructuredCleanupRepository(fake.manager);

    await repository.clear({
      userId: "user-1",
      unitId: "unit-1",
      from: "material",
    });

    expect(
      fake.execute.mock.calls.some(([sql]) =>
        String(sql).includes(`SET "sq3rData" = ''`),
      ),
    ).toBe(false);
  });
});
