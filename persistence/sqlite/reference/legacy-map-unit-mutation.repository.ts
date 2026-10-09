import type { EntityManager } from "@mikro-orm/core";
import { randomUUID } from "node:crypto";
import type { CreateOwnedLegacyMapUnitInput, CreateOwnedLegacyMapUnitResult, DeleteOwnedLegacyMapUnitInput, DeleteOwnedLegacyMapUnitResult, LegacyMapUnitMutationRepository, LegacyMapUnitMutationFailure, LegacyMapUnitRecord, ReorderOwnedLegacyMapUnitsInput, ReorderOwnedLegacyMapUnitsResult, RefineOwnedLegacyMapUnitsInput, RefineOwnedLegacyMapUnitsResult, UpdateOwnedLegacyMapUnitInput, UpdateOwnedLegacyMapUnitResult, } from "@xue-learn/core/source/libs/domain/src/index.ts";
import { nullableReferenceDateValue } from "./date-value.ts";
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
function dateValue(value: unknown): Date | null {
    return nullableReferenceDateValue(value);
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function unitFromRow(row: ValueRow): LegacyMapUnitRecord {
    return {
        id: stringValue(rowValue(row, "id")),
        moduleId: nullableString(rowValue(row, "moduleId")),
        title: stringValue(rowValue(row, "title")),
        status: stringValue(rowValue(row, "status"), "available"),
        unitKind: stringValue(rowValue(row, "unitKind"), "lesson"),
        parentUnitId: nullableString(rowValue(row, "parentUnitId")),
        orderIndex: Number(rowValue(row, "orderIndex") ?? 0),
        prerequisites: stringValue(rowValue(row, "prerequisites"), "[]"),
        contentSummary: stringValue(rowValue(row, "contentSummary")),
        note: stringValue(rowValue(row, "note")),
        mapOrigin: stringValue(rowValue(row, "mapOrigin"), "llm"),
        mapEdited: Boolean(rowValue(row, "mapEdited")),
        linkedGoalId: nullableString(rowValue(row, "linkedGoalId")),
        completionMethod: nullableString(rowValue(row, "completionMethod")),
        completionAttemptId: nullableString(rowValue(row, "completionAttemptId")),
        completedAt: dateValue(rowValue(row, "completedAt")),
    };
}
const unitSelect = `
  SELECT "id", "moduleId", "title", "status", "unitKind", "parentUnitId",
         "orderIndex", "prerequisites", "contentSummary", "note", "mapOrigin",
         "mapEdited", "linkedGoalId", "completionMethod", "completionAttemptId",
         "completedAt"
    FROM __LEARNING_UNIT__`;
/** Transaction-neutral raw-SQL adapter for the hosted legacy map-unit slice. */
export class MikroOrmLegacyMapUnitMutationRepository implements LegacyMapUnitMutationRepository {
    constructor(private readonly em: EntityManager) { }
    private table(table: string): string {
        return qualifiedTable(this.em, table);
    }
    private async ownedLegacyGoal(userId: string, goalId: string): Promise<{
        status: "goal_not_found";
    } | {
        status: "goal_forbidden";
    } | {
        status: "immutable_goal";
    } | {
        status: "ok";
    }> {
        const lock = "";
        const result = await this.em.getConnection().execute(`SELECT "userId", "curriculumVersion"
         FROM ${this.table("LearningGoal")}
        WHERE "id" = ?
        ${lock}`, [goalId]);
        const goal = resultRows(result)[0];
        if (!goal)
            return { status: "goal_not_found" };
        if (stringValue(rowValue(goal, "userId")) !== userId) {
            return { status: "goal_forbidden" };
        }
        if (Number(rowValue(goal, "curriculumVersion") ?? 1) === 2) {
            return { status: "immutable_goal" };
        }
        return { status: "ok" };
    }
    private async findUnit(goalId: string, unitId: string): Promise<ValueRow | undefined> {
        const result = await this.em.getConnection().execute(`${unitSelect.replace("__LEARNING_UNIT__", this.table("LearningUnit"))}
   WHERE "id" = ? AND "goalId" = ?`, [unitId, goalId]);
        return resultRows(result)[0];
    }
    private async findParent(goalId: string, parentUnitId: string): Promise<ValueRow | undefined> {
        const result = await this.em.getConnection().execute(`SELECT "id", "parentUnitId", "unitKind"
         FROM ${this.table("LearningUnit")}
        WHERE "id" = ? AND "goalId" = ?`, [parentUnitId, goalId]);
        return resultRows(result)[0];
    }
    private async validateParent(goalId: string, parentUnitId: string | null): Promise<"ok" | "parent_not_found" | "overview_readonly"> {
        if (!parentUnitId)
            return "ok";
        const parent = await this.findParent(goalId, parentUnitId);
        if (!parent)
            return "parent_not_found";
        if (stringValue(rowValue(parent, "unitKind")) === "overview") {
            return "overview_readonly";
        }
        return "ok";
    }
    private failure(status: LegacyMapUnitMutationFailure["status"]): LegacyMapUnitMutationFailure {
        return { status };
    }
    async createOwnedEditableUnit(input: CreateOwnedLegacyMapUnitInput): Promise<CreateOwnedLegacyMapUnitResult> {
        const goal = await this.ownedLegacyGoal(input.userId, input.goalId);
        if (goal.status !== "ok")
            return this.failure(goal.status);
        const title = input.title.trim();
        if (!title)
            return { status: "title_required" };
        const parentStatus = await this.validateParent(input.goalId, input.parentUnitId);
        if (parentStatus !== "ok")
            return this.failure(parentStatus);
        const parentPredicate = input.parentUnitId
            ? `"parentUnitId" = ?`
            : `"parentUnitId" IS NULL`;
        const parentParams = input.parentUnitId ? [input.parentUnitId] : [];
        const maxResult = await this.em.getConnection().execute(`SELECT MAX("orderIndex") AS "maxOrder"
         FROM ${this.table("LearningUnit")}
        WHERE "goalId" = ? AND ${parentPredicate}`, [input.goalId, ...parentParams]);
        const maxOrder = Number(rowValue(resultRows(maxResult)[0] ?? {}, "maxOrder") ?? -1);
        const id = randomUUID();
        await this.em.getConnection().execute(`INSERT INTO ${this.table("LearningUnit")}
        ("id", "curriculumKey", "goalId", "parentUnitId", "unitKind",
         "title", "orderIndex", "contentSummary", "note", "mapOrigin", "mapEdited")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            id,
            randomUUID(),
            input.goalId,
            input.parentUnitId,
            input.unitKind,
            title,
            maxOrder + 1,
            input.contentSummary,
            input.note,
            input.mapOrigin,
            true,
        ]);
        const created = await this.findUnit(input.goalId, id);
        if (!created)
            return this.failure("unit_not_found");
        return { status: "created", unit: unitFromRow(created) };
    }
    async updateOwnedEditableUnit(input: UpdateOwnedLegacyMapUnitInput): Promise<UpdateOwnedLegacyMapUnitResult> {
        const goal = await this.ownedLegacyGoal(input.userId, input.goalId);
        if (goal.status !== "ok")
            return this.failure(goal.status);
        const existingRow = await this.findUnit(input.goalId, input.unitId);
        if (!existingRow)
            return this.failure("unit_not_found");
        if (stringValue(rowValue(existingRow, "unitKind")) === "overview") {
            return this.failure("overview_readonly");
        }
        const hasParentUpdate = Object.prototype.hasOwnProperty.call(input, "parentUnitId");
        const existingParentUnitId = nullableString(rowValue(existingRow, "parentUnitId"));
        const nextParentUnitId = hasParentUpdate
            ? (input.parentUnitId ?? null)
            : existingParentUnitId;
        if (hasParentUpdate && nextParentUnitId === input.unitId) {
            return this.failure("invalid_edit");
        }
        const parentStatus = await this.validateParent(input.goalId, hasParentUpdate ? nextParentUnitId : null);
        if (parentStatus !== "ok")
            return this.failure(parentStatus);
        if (hasParentUpdate && nextParentUnitId) {
            let cursor = nullableString((await this.findParent(input.goalId, nextParentUnitId))?.parentUnitId);
            while (cursor) {
                if (cursor === input.unitId)
                    return this.failure("invalid_edit");
                const ancestorResult = await this.em.getConnection().execute(`SELECT "parentUnitId"
             FROM ${this.table("LearningUnit")}
            WHERE "id" = ? AND "goalId" = ?`, [cursor, input.goalId]);
                cursor = nullableString(rowValue(resultRows(ancestorResult)[0] ?? {}, "parentUnitId"));
            }
        }
        const existingTitle = stringValue(rowValue(existingRow, "title"));
        const existingSummary = stringValue(rowValue(existingRow, "contentSummary"));
        const hasOrderUpdate = typeof input.orderIndex === "number" && Number.isFinite(input.orderIndex);
        const assignments: string[] = [];
        const params: unknown[] = [];
        if (typeof input.title === "string") {
            const nextTitle = input.title.trim();
            if (!nextTitle)
                return this.failure("title_required");
            assignments.push('"title" = ?');
            params.push(nextTitle);
            assignments.push('"mapEdited" = ?');
            params.push(true);
            if (nextTitle !== existingTitle) {
                assignments.push('"cognitiveModelStatus" = ?');
                params.push("pending");
            }
        }
        if (typeof input.contentSummary === "string") {
            assignments.push('"contentSummary" = ?');
            params.push(input.contentSummary);
            assignments.push('"mapEdited" = ?');
            params.push(true);
            if (input.contentSummary !== existingSummary) {
                assignments.push('"cognitiveModelStatus" = ?');
                params.push("pending");
            }
        }
        if (typeof input.note === "string") {
            assignments.push('"note" = ?');
            params.push(input.note);
            assignments.push('"mapEdited" = ?');
            params.push(true);
        }
        if (hasParentUpdate) {
            const childResult = await this.em.getConnection().execute(`SELECT COUNT(*) AS "count"
           FROM ${this.table("LearningUnit")}
          WHERE "parentUnitId" = ?`, [input.unitId]);
            const childCount = Number(rowValue(resultRows(childResult)[0] ?? {}, "count") ?? 0);
            assignments.push('"parentUnitId" = ?', '"unitKind" = ?', '"mapEdited" = ?');
            params.push(nextParentUnitId, nextParentUnitId ? (childCount > 0 ? "module" : "lesson") : "branch", true);
        }
        if (hasOrderUpdate) {
            assignments.push('"orderIndex" = ?');
            params.push(Math.max(0, Math.floor(input.orderIndex as number)));
        }
        if (assignments.length > 0) {
            await this.em.getConnection().execute(`UPDATE ${this.table("LearningUnit")}
            SET ${assignments.join(", ")}
          WHERE "id" = ? AND "goalId" = ?`, [...params, input.unitId, input.goalId]);
        }
        if (hasParentUpdate || hasOrderUpdate) {
            if (hasParentUpdate && existingParentUnitId !== nextParentUnitId) {
                const oldSiblingsResult = await this.em.getConnection().execute(`SELECT "id"
             FROM ${this.table("LearningUnit")}
            WHERE "goalId" = ? AND ${existingParentUnitId
                    ? '"parentUnitId" = ?'
                    : '"parentUnitId" IS NULL'} AND "unitKind" <> 'overview'
            ORDER BY "orderIndex" ASC`, existingParentUnitId
                    ? [input.goalId, existingParentUnitId]
                    : [input.goalId]);
                for (const [orderIndex, sibling] of resultRows(oldSiblingsResult).entries()) {
                    await this.em.getConnection().execute(`UPDATE ${this.table("LearningUnit")}
                SET "orderIndex" = ?
              WHERE "id" = ?`, [orderIndex, stringValue(rowValue(sibling, "id"))]);
                }
            }
            const siblingsResult = await this.em.getConnection().execute(`SELECT "id"
           FROM ${this.table("LearningUnit")}
          WHERE "goalId" = ? AND ${nextParentUnitId ? '"parentUnitId" = ?' : '"parentUnitId" IS NULL'} AND "unitKind" <> 'overview' AND "id" <> ?
          ORDER BY "orderIndex" ASC`, nextParentUnitId
                ? [input.goalId, nextParentUnitId, input.unitId]
                : [input.goalId, input.unitId]);
            const siblings = resultRows(siblingsResult);
            const requestedIndex = hasOrderUpdate
                ? Math.max(0, Math.floor(input.orderIndex as number))
                : siblings.length;
            const nextIndex = Math.min(requestedIndex, siblings.length);
            const ordered = [
                ...siblings.slice(0, nextIndex),
                { id: input.unitId },
                ...siblings.slice(nextIndex),
            ];
            for (const [orderIndex, sibling] of ordered.entries()) {
                await this.em.getConnection().execute(`UPDATE ${this.table("LearningUnit")}
              SET "orderIndex" = ?
            WHERE "id" = ?`, [orderIndex, stringValue(rowValue(sibling, "id"))]);
            }
        }
        const updated = await this.findUnit(input.goalId, input.unitId);
        if (!updated)
            return this.failure("unit_not_found");
        return { status: "updated", unit: unitFromRow(updated) };
    }
    async reorderOwnedEditableUnits(input: ReorderOwnedLegacyMapUnitsInput): Promise<ReorderOwnedLegacyMapUnitsResult> {
        const goal = await this.ownedLegacyGoal(input.userId, input.goalId);
        if (goal.status !== "ok")
            return this.failure(goal.status);
        if (input.orderedUnitIds.length === 0) {
            return this.failure("invalid_edit");
        }
        const siblingsResult = await this.em.getConnection().execute(`SELECT "id"
         FROM ${this.table("LearningUnit")}
        WHERE "goalId" = ? AND ${input.parentUnitId ? '"parentUnitId" = ?' : '"parentUnitId" IS NULL'} AND "unitKind" <> 'overview'
        ORDER BY "orderIndex" ASC`, input.parentUnitId ? [input.goalId, input.parentUnitId] : [input.goalId]);
        const siblingIds = new Set(resultRows(siblingsResult).map((row) => stringValue(rowValue(row, "id"))));
        if (input.orderedUnitIds.length !== siblingIds.size ||
            input.orderedUnitIds.some((id) => !siblingIds.has(id))) {
            return this.failure("invalid_edit");
        }
        for (const [orderIndex, unitId] of input.orderedUnitIds.entries()) {
            await this.em.getConnection().execute(`UPDATE ${this.table("LearningUnit")}
            SET "orderIndex" = ?
          WHERE "id" = ? AND "goalId" = ?`, [orderIndex, unitId, input.goalId]);
        }
        const unitsResult = await this.em.getConnection().execute(`${unitSelect.replace("__LEARNING_UNIT__", this.table("LearningUnit"))}
       WHERE "goalId" = ? AND "unitKind" <> 'overview'
       ORDER BY "parentUnitId" ASC, "orderIndex" ASC`, [input.goalId]);
        return {
            status: "reordered",
            units: resultRows(unitsResult).map(unitFromRow),
        };
    }
    async deleteOwnedEditableUnit(input: DeleteOwnedLegacyMapUnitInput): Promise<DeleteOwnedLegacyMapUnitResult> {
        const goal = await this.ownedLegacyGoal(input.userId, input.goalId);
        if (goal.status !== "ok")
            return this.failure(goal.status);
        const existing = await this.findUnit(input.goalId, input.unitId);
        if (!existing)
            return this.failure("unit_not_found");
        if (stringValue(rowValue(existing, "unitKind")) === "overview") {
            return this.failure("overview_readonly");
        }
        if (rowValue(existing, "linkedGoalId")) {
            return this.failure("invalid_edit");
        }
        await this.em.getConnection().execute(`DELETE FROM ${this.table("LearningUnit")}
        WHERE "id" = ? AND "goalId" = ?`, [input.unitId, input.goalId]);
        return { status: "deleted" };
    }
    async refineOwnedEditableUnits(input: RefineOwnedLegacyMapUnitsInput): Promise<RefineOwnedLegacyMapUnitsResult> {
        const goal = await this.ownedLegacyGoal(input.userId, input.goalId);
        if (goal.status !== "ok")
            return this.failure(goal.status);
        if (input.updates.length === 0)
            return this.failure("invalid_edit");
        const updateIds = input.updates.map((update) => update.unitId);
        const uniqueIds = new Set(updateIds);
        if (uniqueIds.size !== updateIds.length) {
            return this.failure("invalid_edit");
        }
        const lock = "";
        const placeholders = updateIds.map(() => "?").join(", ");
        const existingResult = await this.em.getConnection().execute(`${unitSelect.replace("__LEARNING_UNIT__", this.table("LearningUnit"))}
       WHERE "goalId" = ? AND "id" IN (${placeholders})${lock}`, [input.goalId, ...updateIds]);
        const existingRows = resultRows(existingResult);
        const existingById = new Map(existingRows.map((row) => [stringValue(rowValue(row, "id")), row]));
        for (const update of input.updates) {
            const existing = existingById.get(update.unitId);
            if (!existing)
                return this.failure("unit_not_found");
            if (stringValue(rowValue(existing, "unitKind")) === "overview") {
                return this.failure("overview_readonly");
            }
        }
        for (const update of input.updates) {
            const existing = existingById.get(update.unitId)!;
            const existingTitle = stringValue(rowValue(existing, "title"));
            const existingSummary = stringValue(rowValue(existing, "contentSummary"));
            await this.em.getConnection().execute(`UPDATE ${this.table("LearningUnit")}
            SET "title" = ?,
                "contentSummary" = ?,
                "orderIndex" = ?,
                "cognitiveModelStatus" = ?
          WHERE "id" = ? AND "goalId" = ?`, [
                update.title,
                update.contentSummary,
                update.orderIndex,
                update.title !== existingTitle ||
                    update.contentSummary !== existingSummary
                    ? "pending"
                    : stringValue(rowValue(existing, "cognitiveModelStatus"), "pending"),
                update.unitId,
                input.goalId,
            ]);
        }
        const unitsResult = await this.em.getConnection().execute(`${unitSelect.replace("__LEARNING_UNIT__", this.table("LearningUnit"))}
       WHERE "goalId" = ? AND "unitKind" <> 'overview'
       ORDER BY "parentUnitId" ASC, "orderIndex" ASC`, [input.goalId]);
        return {
            status: "refined",
            units: resultRows(unitsResult).map(unitFromRow),
        };
    }
}
