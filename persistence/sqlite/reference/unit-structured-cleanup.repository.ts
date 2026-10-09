import type { EntityManager } from "@mikro-orm/core";
import type { UnitStructuredCleanupRepository } from "@xue-learn/core/source/libs/domain/src/index.ts";

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
  return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}

function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmUnitStructuredCleanupRepository implements UnitStructuredCleanupRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }

  private async deleteGeneratedSectionContent(sectionIds: readonly string[]) {
    if (!sectionIds.length) return;
    const placeholders = sectionIds.map(() => "?").join(", ");
    for (const name of [
      "UnitSectionMaterial",
      "UnitSectionDerivation",
      "UnitSectionTeachingDerivation",
      "TeachingDerivationRun",
      "FormalDerivationRun",
      "UnitSectionProgress",
      "ChatNarrationAudio",
    ]) {
      await this.execute(
        `DELETE FROM ${table(this.em, name)} WHERE "sectionId" IN (${placeholders})`,
        [...sectionIds],
      );
    }
  }

  async clear(input: {
    userId: string;
    unitId: string;
    from: "sq" | "material";
  }): Promise<void> {
    const owned = rows(
      await this.execute(
        `SELECT u."id" FROM ${table(this.em, "LearningUnit")} u
          JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
         WHERE u."id" = ? AND g."userId" = ?`,
        [input.unitId, input.userId],
      ),
    )[0];
    if (!owned) throw new Error("Unit not found");
    const sectionIds = rows(
      await this.execute(
        `SELECT "id" FROM ${table(this.em, "MainCourseSection")} WHERE "unitId" = ?`,
        [input.unitId],
      ),
    ).map((row) => String(value(row, "id")));
    await this.deleteGeneratedSectionContent(sectionIds);
    if (input.from === "sq") {
      await this.execute(
        `DELETE FROM ${table(this.em, "LearningMaterial")} WHERE "unitId" = ?`,
        [input.unitId],
      );
      await this.execute(
        `DELETE FROM ${table(this.em, "UnitSection")} WHERE "courseRole" = \'main\' AND "unitId" = ?`,
        [input.unitId],
      );
      await this.execute(
        `UPDATE ${table(this.em, "UnitSessionState")} SET "sq3rData" = ''
          WHERE "unitId" = ?`,
        [input.unitId],
      );
    } else {
      await this.execute(
        `UPDATE ${table(this.em, "UnitSection")}
            SET "generationStatus" = 'pending', "generationError" = '',
                "generationStartedAt" = NULL, "generationToken" = NULL,
                "testGenerationStatus" = 'pending', "testGenerationError" = '',
                "testGenerationStartedAt" = NULL, "testGenerationToken" = NULL
          WHERE "courseRole" = \'main\' AND "unitId" = ?`,
        [input.unitId],
      );
    }
    for (const name of ["CornellNote"]) {
      await this.execute(
        `DELETE FROM ${table(this.em, name)} WHERE "unitId" = ?`,
        [input.unitId],
      );
    }
    const session = rows(
      await this.execute(
        `SELECT "graphState" FROM ${table(this.em, "UnitSessionState")} WHERE "unitId" = ?`,
        [input.unitId],
      ),
    )[0];
    if (!session) return;
    const raw = value(session, "graphState");
    let graph: Record<string, unknown> = {};
    try {
      graph = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<
        string,
        unknown
      >;
    } catch {
      graph = {};
    }
    for (const key of [
      "sqQuestionAnswers",
    ]) {
      delete graph[key];
    }
    await this.execute(
      `UPDATE ${table(this.em, "UnitSessionState")} SET "graphState" = ?
        WHERE "unitId" = ?`,
      [JSON.stringify(graph), input.unitId],
    );
  }
}
