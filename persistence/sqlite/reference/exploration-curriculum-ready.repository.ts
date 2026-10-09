import type { EntityManager } from "@mikro-orm/core";
import type { EnsureExplorationCurriculumReadyInput, ExplorationCurriculumReadyRepository, } from "@xue-learn/core/domain";
type ValueRow = Readonly<Record<string, unknown>>;
function resultRows(result: unknown): readonly ValueRow[] {
    if (Array.isArray(result))
        return result as ValueRow[];
    if (result && typeof result === "object" && "rows" in result) {
        const rows = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(rows) ? (rows as ValueRow[]) : [];
    }
    return [];
}
function rowValue(row: ValueRow, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/** Raw-SQL owner-scoped healing for materialized exploration curriculum. */
export class MikroOrmExplorationCurriculumReadyRepository implements ExplorationCurriculumReadyRepository {
    constructor(private readonly em: EntityManager) { }
    async ensureOwned(input: EnsureExplorationCurriculumReadyInput): Promise<boolean> {
        return this.em.transactional((tx) => this.ensureInTransaction(tx, input));
    }
    private async ensureInTransaction(em: EntityManager, input: EnsureExplorationCurriculumReadyInput): Promise<boolean> {
        const goalTable = qualifiedTable(em, "LearningGoal");
        const moduleTable = qualifiedTable(em, "LearningModule");
        const unitTable = qualifiedTable(em, "LearningUnit");
        const connection = em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, em.getTransactionContext());
        const goal = resultRows(await execute(`SELECT "id", "learningMode"
           FROM ${goalTable}
          WHERE "id" = ? AND "userId" = ?
          ${""}`, [input.goalId, input.userId]))[0];
        if (!goal || rowValue(goal, "learningMode") !== "exploration") {
            return false;
        }
        const modules = resultRows(await execute(`SELECT "id", "generationStatus", "generationBuildStartedAt",
                "generationBuildToken", "generationError", "generatedAt"
           FROM ${moduleTable}
          WHERE "goalId" = ?
          ORDER BY "orderIndex" ASC, "id" ASC`, [input.goalId]));
        const lessons = resultRows(await execute(`SELECT u."id" AS "unitId", u."moduleId" AS "moduleId",
                u."cognitiveModelStatus", u."cognitiveModelBuildStartedAt",
                u."cognitiveModelBuildToken", u."cognitiveModelBuildInputHash"
           FROM ${unitTable} u
           JOIN ${moduleTable} m ON m."id" = u."moduleId"
          WHERE u."goalId" = ?
            AND m."goalId" = ?
            AND u."unitKind" = 'lesson'`, [input.goalId, input.goalId]));
        const lessonsByModule = new Map<string, readonly ValueRow[]>();
        for (const lesson of lessons) {
            const moduleId = rowValue(lesson, "moduleId");
            if (typeof moduleId !== "string")
                continue;
            const current = lessonsByModule.get(moduleId) ?? [];
            lessonsByModule.set(moduleId, [...current, lesson]);
        }
        const now = new Date();
        let changed = false;
        for (const module of modules) {
            const moduleId = rowValue(module, "id");
            if (typeof moduleId !== "string")
                continue;
            const moduleLessons = lessonsByModule.get(moduleId) ?? [];
            // Preserve the hosted healing rule: only a materialized module with at
            // least one non-expanded lesson is normalized as a whole.
            if (moduleLessons.length > 0 &&
                moduleLessons.some((lesson) => rowValue(lesson, "cognitiveModelStatus") !== "expanded")) {
                await execute(`UPDATE ${unitTable}
              SET "cognitiveModelStatus" = 'expanded',
                  "cognitiveModelBuildStartedAt" = NULL,
                  "cognitiveModelBuildToken" = NULL,
                  "cognitiveModelBuildInputHash" = NULL
            WHERE "moduleId" = ? AND "unitKind" = 'lesson'`, [moduleId]);
                changed = true;
            }
            // Empty/locked exploration stubs remain lazy. Materialized modules are
            // the only rows healed to a ready generation state.
            if (moduleLessons.length > 0 &&
                rowValue(module, "generationStatus") !== "ready") {
                await execute(`UPDATE ${moduleTable}
              SET "generationStatus" = 'ready',
                  "generationBuildStartedAt" = NULL,
                  "generationBuildToken" = NULL,
                  "generationError" = '',
                  "generatedAt" = COALESCE("generatedAt", ?),
                  "updatedAt" = ?
            WHERE "id" = ? AND "goalId" = ?`, [now, now, moduleId, input.goalId]);
                changed = true;
            }
        }
        return changed;
    }
}
