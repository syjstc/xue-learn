import type { EntityManager } from "@mikro-orm/core";
import type { UnitContentRevisionRepository } from "@xue-learn/core/domain";

type Row = Readonly<Record<string, unknown>>;
function rows(result: unknown): readonly Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? (value as Row[]) : [];
  }
  return [];
}
function value(row: Row, key: string): unknown {
  return row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
}
function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
class StaleRevision extends Error {
  constructor(readonly currentContentRevision?: number) {
    super("stale unit content revision");
  }
}

export class MikroOrmUnitContentRevisionRepository implements UnitContentRevisionRepository {
  constructor(private readonly em: EntityManager) {}

  async bump(unitId: string): Promise<number> {
    const updated = rows(
      await this.em.getConnection().execute(
        `UPDATE ${table(this.em, "LearningUnit")}
            SET "contentRevision" = "contentRevision" + 1
          WHERE "id" = ? RETURNING "contentRevision"`,
        [unitId],
      ),
    )[0];
    if (!updated) throw new Error("Unit not found");
    return Number(value(updated, "contentRevision"));
  }

  async commitSqPreview(input: {
    unitId: string;
    expectedContentRevision: number;
    sq3rData: string;
  }) {
    try {
      return await this.em.transactional(async (em) => {
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) =>
          connection.execute(
            sql,
            params,
            undefined,
            em.getTransactionContext(),
          );
        await execute(
          `UPDATE ${table(em, "UnitSessionState")}
            SET "sq3rData" = ?, "structuredSubStep" = 'sq',
                "currentStep" = 'structured_input', "updatedAt" = ?
          WHERE "unitId" = ?`,
          [input.sq3rData, new Date(), input.unitId],
        );
        const claimed = rows(
          await execute(
            `UPDATE ${table(em, "LearningUnit")}
              SET "contentRevision" = "contentRevision" + 1
            WHERE "id" = ? AND "contentRevision" = ?
            RETURNING "contentRevision"`,
            [input.unitId, input.expectedContentRevision],
          ),
        )[0];
        if (claimed) {
          return {
            status: "committed" as const,
            contentRevision: Number(value(claimed, "contentRevision")),
          };
        }
        const current = rows(
          await execute(
            `SELECT "contentRevision" FROM ${table(em, "LearningUnit")}
            WHERE "id" = ?`,
            [input.unitId],
          ),
        )[0];
        throw new StaleRevision(
          current ? Number(value(current, "contentRevision")) : undefined,
        );
      });
    } catch (error) {
      if (!(error instanceof StaleRevision)) throw error;
      return {
        status: "stale" as const,
        currentContentRevision: error.currentContentRevision,
      };
    }
  }
}
