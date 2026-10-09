import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type {
  CreateRagDocumentInput,
  RagDocumentRecord,
  RagDocumentRepository,
} from "@xue-learn/core/domain";

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
function optional(row: Row, key: string): string | null {
  const item = value(row, key);
  return item == null ? null : String(item);
}
function record(row: Row): RagDocumentRecord {
  return {
    id: String(value(row, "id")),
    goalId: String(value(row, "goalId")),
    filename: String(value(row, "filename")),
    sourceType: String(value(row, "sourceType")),
    sourceUrl: optional(row, "sourceUrl"),
    canonicalUrl: optional(row, "canonicalUrl"),
    provider: optional(row, "provider"),
    title: optional(row, "title"),
    warning: optional(row, "warning"),
    subtitleStatus: optional(row, "subtitleStatus"),
    storageKey: optional(row, "storageKey"),
    contentHash: optional(row, "contentHash"),
    contentType: optional(row, "contentType"),
    byteSize:
      value(row, "byteSize") == null ? null : Number(value(row, "byteSize")),
  };
}
function table(em: EntityManager, name: string): string {
  const schema = em.schema ?? em.config?.getSchema();
  const quoted = `"${name.replaceAll('"', '""')}"`;
  return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}

export class MikroOrmRagDocumentRepository implements RagDocumentRepository {
  constructor(private readonly em: EntityManager) {}

  async findGoalSearchContext(
    goalId: string,
  ): Promise<Readonly<{ userId: string; generationOptions: string }> | null> {
    const found = rows(
      await this.execute(
        `SELECT "userId", "generationOptions"
           FROM ${table(this.em, "LearningGoal")}
          WHERE "id" = ? AND "userId" IS NOT NULL LIMIT 1`,
        [goalId],
      ),
    )[0];
    if (!found) return null;
    return {
      userId: String(value(found, "userId")),
      generationOptions: String(value(found, "generationOptions") ?? ""),
    };
  }
  private execute(sql: string, params: unknown[] = []) {
    return this.em.getConnection().execute(sql, params);
  }
  private async find(where: string, params: unknown[]) {
    const row = rows(
      await this.execute(
        `SELECT * FROM ${table(this.em, "UploadedDocument")} WHERE ${where} LIMIT 1`,
        params,
      ),
    )[0];
    return row ? record(row) : null;
  }
  async resolveOwnedScope(
    userId: string,
    subject: { goalId?: string; unitId?: string },
  ): Promise<{ goalId: string; unitTitle: string } | null> {
    if (subject.unitId) {
      const row = rows(
        await this.execute(
          `SELECT u."goalId", u."title" AS "unitTitle"
             FROM ${table(this.em, "LearningUnit")} u
             JOIN ${table(this.em, "LearningGoal")} g ON g."id" = u."goalId"
            WHERE u."id" = ? AND g."userId" = ?${subject.goalId ? ' AND u."goalId" = ?' : ""}
            LIMIT 1`,
          [subject.unitId, userId, ...(subject.goalId ? [subject.goalId] : [])],
        ),
      )[0];
      return row
        ? {
            goalId: String(value(row, "goalId")),
            unitTitle: String(value(row, "unitTitle")),
          }
        : null;
    }
    if (!subject.goalId) return null;
    const row = rows(
      await this.execute(
        `SELECT "id" AS "goalId", "title" AS "unitTitle"
           FROM ${table(this.em, "LearningGoal")}
          WHERE "id" = ? AND "userId" = ?
          LIMIT 1`,
        [subject.goalId, userId],
      ),
    )[0];
    return row
      ? {
          goalId: String(value(row, "goalId")),
          unitTitle: String(value(row, "unitTitle")),
        }
      : null;
  }
  async ownsGoal(userId: string, goalId: string): Promise<boolean> {
    return (
      rows(
        await this.execute(
          `SELECT 1 AS "found" FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? AND "userId" = ? LIMIT 1`,
          [goalId, userId],
        ),
      ).length > 0
    );
  }
  async countByGoal(
    goalId: string,
    filter?: { filename?: string; excludeFilename?: string },
  ): Promise<number> {
    const suffix = filter?.filename
      ? ` AND "filename" = ?`
      : filter?.excludeFilename
        ? ` AND "filename" <> ?`
        : "";
    const params = [
      goalId,
      ...(filter?.filename
        ? [filter.filename]
        : filter?.excludeFilename
          ? [filter.excludeFilename]
          : []),
    ];
    const row = rows(
      await this.execute(
        `SELECT COUNT(*) AS "count" FROM ${table(this.em, "UploadedDocument")} WHERE "goalId" = ?${suffix}`,
        params,
      ),
    )[0];
    return Number(value(row ?? {}, "count")) || 0;
  }
  findById(goalId: string, documentId: string) {
    return this.find(`"goalId" = ? AND "id" = ?`, [goalId, documentId]);
  }
  findByFilename(goalId: string, filename: string) {
    return this.find(`"goalId" = ? AND "filename" = ?`, [goalId, filename]);
  }
  findByCanonicalUrl(goalId: string, canonicalUrl: string) {
    return this.find(`"goalId" = ? AND "canonicalUrl" = ?`, [
      goalId,
      canonicalUrl,
    ]);
  }
  async countByStorageKey(storageKey: string): Promise<number> {
    const row = rows(
      await this.execute(
        `SELECT COUNT(*) AS "count" FROM ${table(this.em, "UploadedDocument")} WHERE "storageKey" = ?`,
        [storageKey],
      ),
    )[0];
    return Number(value(row ?? {}, "count")) || 0;
  }
  async create(input: CreateRagDocumentInput): Promise<RagDocumentRecord> {
    const id = randomUUID();
    await this.execute(
      `INSERT INTO ${table(this.em, "UploadedDocument")}
      ("id", "goalId", "filename", "sourceType", "sourceUrl", "canonicalUrl", "provider", "title", "warning", "subtitleStatus", "storageKey", "contentHash", "contentType", "byteSize", "createdAt")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.goalId,
        input.filename,
        input.sourceType,
        input.sourceUrl,
        input.canonicalUrl,
        input.provider,
        input.title,
        input.warning,
        input.subtitleStatus,
        input.storageKey ?? null,
        input.contentHash ?? null,
        input.contentType ?? null,
        input.byteSize ?? null,
        new Date(),
      ],
    );
    return {
      id,
      ...input,
      storageKey: input.storageKey ?? null,
      contentHash: input.contentHash ?? null,
      contentType: input.contentType ?? null,
      byteSize: input.byteSize ?? null,
    };
  }
  async update(
    documentId: string,
    patch: Partial<Omit<RagDocumentRecord, "id" | "goalId">>,
  ): Promise<RagDocumentRecord | null> {
    const keys = [
      "filename",
      "sourceType",
      "sourceUrl",
      "canonicalUrl",
      "provider",
      "title",
      "warning",
      "subtitleStatus",
      "storageKey",
      "contentHash",
      "contentType",
      "byteSize",
    ] as const;
    const selected = keys.filter((key) => key in patch);
    if (selected.length)
      await this.execute(
        `UPDATE ${table(this.em, "UploadedDocument")} SET ${selected.map((key) => `"${key}" = ?`).join(", ")} WHERE "id" = ?`,
        [...selected.map((key) => patch[key] ?? null), documentId],
      );
    return this.find(`"id" = ?`, [documentId]);
  }
  async delete(goalId: string, documentId: string): Promise<boolean> {
    const existing = await this.findById(goalId, documentId);
    if (!existing) return false;
    await this.execute(
      `DELETE FROM ${table(this.em, "UploadedDocument")} WHERE "goalId" = ? AND "id" = ?`,
      [goalId, documentId],
    );
    return true;
  }
  async deleteByFilename(goalId: string, filename: string): Promise<number> {
    const count = await this.countByGoal(goalId, { filename });
    if (count > 0) {
      await this.execute(
        `DELETE FROM ${table(this.em, "UploadedDocument")} WHERE "goalId" = ? AND "filename" = ?`,
        [goalId, filename],
      );
    }
    return count;
  }
}
