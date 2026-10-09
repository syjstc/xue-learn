import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { LegacyMapReplacementGoalRecord, LegacyMapReplacementRepository, LegacyMapReconciliationUnit, LegacyMapReplacementUnit, LegacyMapReplacementUnitRecord, PersistOwnedLegacyMapReplacementInput, PersistOwnedLegacyMapReplacementResult, } from "@xue-learn/core/source/libs/domain/src/index.ts";
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
function stringValue(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}
function nullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function invalid(reason: string): PersistOwnedLegacyMapReplacementResult {
    return { status: "invalid_input", reason };
}
function validateUnits(units: readonly LegacyMapReplacementUnit[]): PersistOwnedLegacyMapReplacementResult | null {
    if (units.length === 0)
        return invalid("map must contain a unit");
    const refs = new Set<string>();
    for (const unit of units) {
        if (!unit.ref || refs.has(unit.ref)) {
            return invalid("map unit refs must be unique");
        }
        refs.add(unit.ref);
    }
    for (const unit of units) {
        if (unit.parentRef && !refs.has(unit.parentRef)) {
            return invalid(`missing parent ref: ${unit.parentRef}`);
        }
        for (const prerequisiteRef of unit.prerequisiteRefs) {
            if (!refs.has(prerequisiteRef)) {
                return invalid(`missing prerequisite ref: ${prerequisiteRef}`);
            }
        }
    }
    return null;
}
function unitRecord(row: ValueRow): LegacyMapReplacementUnitRecord {
    return {
        id: stringValue(rowValue(row, "id")),
        title: stringValue(rowValue(row, "title")),
        unitKind: stringValue(rowValue(row, "unitKind"), "lesson"),
        parentUnitId: nullableString(rowValue(row, "parentUnitId")),
        orderIndex: Number(rowValue(row, "orderIndex") ?? 0),
        difficulty: stringValue(rowValue(row, "difficulty"), "medium"),
        contentSummary: stringValue(rowValue(row, "contentSummary")),
        prerequisites: stringValue(rowValue(row, "prerequisites"), "[]"),
    };
}
/** Transaction-neutral owner-scoped legacy map replacement adapter. */
export class MikroOrmLegacyMapReplacementRepository implements LegacyMapReplacementRepository {
    constructor(private readonly em: EntityManager) { }
    async listOwnedReconciliationUnits(userId: string, goalId: string): Promise<readonly LegacyMapReconciliationUnit[] | null> {
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const owned = resultRows(await execute(`SELECT "id" FROM ${qualifiedTable(this.em, "LearningGoal")}
          WHERE "id" = ? AND "userId" = ? LIMIT 1`, [goalId, userId]))[0];
        if (!owned)
            return null;
        const units = resultRows(await execute(`SELECT "id", "parentUnitId", "title", "contentSummary", "curriculumKey",
                "planAreaRef", "planningOutcomeRefs"
           FROM ${qualifiedTable(this.em, "LearningUnit")}
          WHERE "goalId" = ? AND "unitKind" <> 'overview'`, [goalId]));
        const mappings = resultRows(await execute(`SELECT m."unitId", m."learningTargetId", m."localRef", m."required",
                m."weight", m."orderIndex", m."role", m."isEntry", m."isExit"
           FROM ${qualifiedTable(this.em, "UnitLearningTarget")} m
           JOIN ${qualifiedTable(this.em, "LearningTarget")} t ON t."id" = m."learningTargetId"
          WHERE t."goalId" = ? AND t."status" = 'active'
          ORDER BY m."orderIndex" ASC, m."id" ASC`, [goalId]));
        const stringArray = (raw: unknown): readonly string[] => {
            if (Array.isArray(raw))
                return raw.filter((item): item is string => typeof item === "string");
            if (typeof raw !== "string" || !raw.trim())
                return [];
            try {
                const parsed = JSON.parse(raw) as unknown;
                return Array.isArray(parsed)
                    ? parsed.filter((item): item is string => typeof item === "string")
                    : [];
            }
            catch {
                return [];
            }
        };
        return units.map((unit) => {
            const unitId = stringValue(rowValue(unit, "id"));
            return {
                id: unitId,
                parentUnitId: nullableString(rowValue(unit, "parentUnitId")),
                title: stringValue(rowValue(unit, "title")),
                contentSummary: stringValue(rowValue(unit, "contentSummary")),
                curriculumKey: stringValue(rowValue(unit, "curriculumKey")),
                planAreaRef: stringValue(rowValue(unit, "planAreaRef")),
                planningOutcomeRefs: stringArray(rowValue(unit, "planningOutcomeRefs")),
                learningTargets: mappings
                    .filter((mapping) => rowValue(mapping, "unitId") === unitId)
                    .map((mapping) => ({
                    learningTargetId: stringValue(rowValue(mapping, "learningTargetId")),
                    localRef: stringValue(rowValue(mapping, "localRef")),
                    required: Boolean(rowValue(mapping, "required")),
                    weight: Number(rowValue(mapping, "weight")) || 0,
                    orderIndex: Number(rowValue(mapping, "orderIndex")) || 0,
                    role: stringValue(rowValue(mapping, "role")),
                    isEntry: Boolean(rowValue(mapping, "isEntry")),
                    isExit: Boolean(rowValue(mapping, "isExit")),
                })),
            };
        });
    }
    async replaceOwned(input: PersistOwnedLegacyMapReplacementInput): Promise<PersistOwnedLegacyMapReplacementResult> {
        const validation = validateUnits(input.units);
        if (validation)
            return validation;
        const connection = this.em.getConnection();
        const execute = (sql: string, params: unknown[] = []) => connection.execute(sql, params, undefined, this.em.getTransactionContext());
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const targetTable = qualifiedTable(this.em, "UnitLearningTarget");
        const lock = "";
        const goalResult = await execute(`SELECT "id", "userId"
         FROM ${goalTable}
        WHERE "id" = ? AND "userId" = ?${lock}`, [input.goalId, input.userId]);
        const goal = resultRows(goalResult)[0];
        if (!goal)
            return { status: "not_found" };
        const unitIds = new Map(input.units.map((unit) => [unit.ref, randomUUID()]));
        const now = new Date();
        await execute(`DELETE FROM ${unitTable} WHERE "goalId" = ?`, [
            input.goalId,
        ]);
        await execute(`UPDATE ${goalTable}
          SET "title" = ?,
              "level" = ?,
              "domainTag" = ?,
              "pathSource" = ?,
              "contentLanguage" = ?,
              "goalKind" = COALESCE(?, "goalKind"),
              "mapPlanStatus" = COALESCE(?, "mapPlanStatus"),
              "mapSummaryStatus" = COALESCE(?, "mapSummaryStatus"),
              "detailedPlanStatus" = COALESCE(?, 'stale'),
              "cognitiveModelEnabled" = true,
              "cognitiveModelStatus" = 'building',
              "updatedAt" = ?
        WHERE "id" = ? AND "userId" = ?`, [
            input.title,
            input.level,
            input.domainTag,
            input.pathSource,
            input.contentLanguage,
            input.goalKind ?? null,
            input.mapPlanStatus ?? null,
            input.mapSummaryStatus ?? null,
            input.detailedPlanStatus ?? null,
            now,
            input.goalId,
            input.userId,
        ]);
        for (const unit of input.units) {
            const unitId = unitIds.get(unit.ref)!;
            const parentUnitId = unit.parentRef
                ? (unitIds.get(unit.parentRef) ?? null)
                : null;
            const prerequisiteIds = unit.prerequisiteRefs.map((ref) => unitIds.get(ref)!);
            await execute(`INSERT INTO ${unitTable}
          ("id", "curriculumKey", "goalId", "parentUnitId", "unitKind",
           "title", "orderIndex", "difficulty", "prerequisites",
           "contentSummary", "planAreaRef", "planningOutcomeRefs",
           "status", "cognitiveModelStatus")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)`, [
                unitId,
                unit.curriculumKey ?? randomUUID(),
                input.goalId,
                parentUnitId,
                unit.unitKind,
                unit.title,
                unit.orderIndex,
                unit.difficulty,
                JSON.stringify(prerequisiteIds),
                unit.contentSummary,
                unit.planAreaRef,
                JSON.stringify(unit.planningOutcomeRefs),
                unit.cognitiveModelStatus,
            ]);
            for (const target of unit.learningTargets) {
                await execute(`INSERT INTO ${targetTable}
            ("id", "unitId", "learningTargetId", "localRef", "required",
             "weight", "orderIndex", "role", "isEntry", "isExit")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    randomUUID(),
                    unitId,
                    target.learningTargetId,
                    target.localRef,
                    target.required,
                    target.weight,
                    target.orderIndex,
                    target.role,
                    target.isEntry,
                    target.isExit,
                ]);
            }
        }
        const unitsResult = await execute(`SELECT "id", "title", "unitKind", "parentUnitId", "orderIndex",
              "difficulty", "contentSummary", "prerequisites"
         FROM ${unitTable}
        WHERE "goalId" = ?
        ORDER BY "parentUnitId" ASC, "orderIndex" ASC`, [input.goalId]);
        const record: LegacyMapReplacementGoalRecord = {
            id: input.goalId,
            userId: nullableString(rowValue(goal, "userId")) ?? input.userId,
            title: input.title,
            level: input.level,
            domainTag: input.domainTag,
            pathSource: input.pathSource,
            contentLanguage: input.contentLanguage,
        };
        return {
            status: "replaced",
            goal: record,
            units: resultRows(unitsResult).map(unitRecord),
        };
    }
}
