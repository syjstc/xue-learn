import type { EntityManager } from "@mikro-orm/core";
import type {
  GoalIconMetadata,
  GoalIconRepository,
  GoalIconScope,
  SaveOwnedGoalIconInput,
} from "@xue-learn/core/source/libs/domain/src/index.ts";

type Row = Readonly<Record<string, unknown>>;

function rows(value: unknown): readonly Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (value && typeof value === "object" && "rows" in value) {
    const result = (value as { rows?: unknown }).rows;
    return Array.isArray(result) ? (result as Row[]) : [];
  }
  return [];
}

function value(row: Row, key: string): unknown {
  return row[key] ?? row[key[0]!.toLowerCase() + key.slice(1)];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

function metadata(row: Row): GoalIconMetadata {
  return {
    id: stringValue(value(row, "id")),
    title: stringValue(value(row, "title")),
    iconSvg: stringValue(value(row, "iconSvg")),
    iconTint: stringValue(value(row, "iconTint")),
  };
}

/** Transaction-neutral owner-scoped goal-icon metadata adapter. */
export class MikroOrmGoalIconRepository implements GoalIconRepository {
  constructor(private readonly em: EntityManager) {}

  private execute(sql: string, params: unknown[] = []) {
    return this.em
      .getConnection()
      .execute(sql, params, undefined, this.em.getTransactionContext());
  }

  async findOwned(input: GoalIconScope): Promise<GoalIconMetadata | null> {
    const result = await this.execute(
      `SELECT "id", "title", "iconSvg", "iconTint"
         FROM ${table(this.em, "LearningGoal")}
        WHERE "id" = ? AND "userId" = ?`,
      [input.goalId, input.userId],
    );
    const row = rows(result)[0];
    return row ? metadata(row) : null;
  }

  async saveOwnedIfEmpty(
    input: SaveOwnedGoalIconInput,
  ): Promise<GoalIconMetadata | null> {
    await this.execute(
      `UPDATE ${table(this.em, "LearningGoal")}
          SET "iconSvg" = ?,
              "iconTint" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ? AND "iconSvg" = ''`,
      [input.iconSvg, input.iconTint, new Date(), input.goalId, input.userId],
    );

    // The read is in the same runtime-owned transaction as the conditional
    // update, so a losing concurrent generator returns the winner's icon.
    return this.findOwned(input);
  }
}
