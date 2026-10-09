import { randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { CognitiveModelPublicationFinalizationRepository, CognitiveModelPublicationFinalizationResult, FinalizeCognitiveModelPublicationInput, } from "@xue-learn/core/domain";
import { MikroOrmCognitiveModelPublicationRepository } from "./cognitive-model-publication.repository.ts";
type Row = Readonly<Record<string, unknown>>;
const COGNITIVE_MODEL_SCHEMA_VERSION = 1;
function resultRows(result: unknown): readonly Row[] {
    if (Array.isArray(result))
        return result as Row[];
    if (result && typeof result === "object" && "rows" in result) {
        const rows = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(rows) ? (rows as Row[]) : [];
    }
    return [];
}
function rowValue(row: Row, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function stringValue(value: unknown): string | null {
    return typeof value === "string"
        ? value
        : value == null
            ? null
            : String(value);
}
function numberValue(value: unknown): number {
    if (typeof value === "number")
        return value;
    if (typeof value === "bigint")
        return Number(value);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function parseJson(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function snapshotIncludesUnit(value: unknown, unitId: string): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const units = (value as {
        units?: unknown;
    }).units;
    if (!Array.isArray(units))
        return false;
    return units.some((unit) => unit &&
        typeof unit === "object" &&
        !Array.isArray(unit) &&
        (unit as {
            unitId?: unknown;
        }).unitId === unitId);
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
/**
 * Transaction-neutral finalization adapter. The runtime wraps this complete
 * operation in one transaction; it never writes learner evidence or model
 * proposal rows.
 */
export class MikroOrmCognitiveModelPublicationFinalizationRepository implements CognitiveModelPublicationFinalizationRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    async promoteExisting(input: {
        goalId: string;
        unitId: string;
        inputHash: string;
    }): Promise<CognitiveModelPublicationFinalizationResult | null> {
        const prepared = await new MikroOrmCognitiveModelPublicationRepository(this.em).buildExistingExpandedSnapshot(input);
        return prepared ? this.finalize({ ...input, ...prepared }) : null;
    }
    async finalize(input: FinalizeCognitiveModelPublicationInput): Promise<CognitiveModelPublicationFinalizationResult | null> {
        JSON.parse(input.snapshotJson);
        JSON.parse(input.auditJson);
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const targetTable = qualifiedTable(this.em, "UnitLearningTarget");
        const revisionTable = qualifiedTable(this.em, "CognitiveModelRevision");
        const lock = "";
        const goal = resultRows(await this.execute(`SELECT "id", "cognitiveModelInputHash", "cognitiveModelPublishedHash",
                "cognitiveModelVersion", "curriculumVersion"
           FROM ${goalTable}
          WHERE "id" = ?${lock}`, [input.goalId]))[0];
        if (!goal)
            throw new Error("Goal not found");
        if (stringValue(rowValue(goal, "cognitiveModelInputHash")) !==
            input.inputHash ||
            stringValue(rowValue(goal, "cognitiveModelPublishedHash")) !==
                input.inputHash) {
            return null;
        }
        const unit = resultRows(await this.execute(`SELECT u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash",
                COUNT(ult."id") AS "targetCount"
           FROM ${unitTable} u
           LEFT JOIN ${targetTable} ult ON ult."unitId" = u."id"
          WHERE u."id" = ? AND u."goalId" = ? AND u."unitKind" = 'lesson'
          GROUP BY u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash"`, [input.unitId, input.goalId]))[0];
        if (!unit ||
            stringValue(rowValue(unit, "cognitiveModelStatus")) !== "expanded" ||
            stringValue(rowValue(unit, "cognitiveModelBuildInputHash")) !==
                input.inputHash ||
            numberValue(rowValue(unit, "targetCount")) === 0) {
            return null;
        }
        const latestPublished = resultRows(await this.execute(`SELECT "version", "snapshotJson"
           FROM ${revisionTable}
          WHERE "goalId" = ? AND "inputHash" = ?
            AND "status" = 'published' AND "isFullSnapshot" = true
          ORDER BY "version" DESC
          LIMIT 1${lock}`, [input.goalId, input.inputHash]))[0];
        if (latestPublished &&
            snapshotIncludesUnit(parseJson(rowValue(latestPublished, "snapshotJson")), input.unitId)) {
            return this.result(input, numberValue(rowValue(latestPublished, "version")));
        }
        const units = resultRows(await this.execute(`SELECT u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash",
                COUNT(ult."id") AS "targetCount"
           FROM ${unitTable} u
           LEFT JOIN ${targetTable} ult ON ult."unitId" = u."id"
          WHERE u."goalId" = ? AND u."unitKind" = 'lesson'
          GROUP BY u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash"`, [input.goalId]));
        let allExpanded = units.every((candidate) => stringValue(rowValue(candidate, "cognitiveModelStatus")) ===
            "expanded" &&
            stringValue(rowValue(candidate, "cognitiveModelBuildInputHash")) ===
                input.inputHash &&
            numberValue(rowValue(candidate, "targetCount")) > 0);
        if (numberValue(rowValue(goal, "curriculumVersion")) === 2) {
            const pending = resultRows(await this.execute(`SELECT COUNT(*) AS "count"
             FROM ${qualifiedTable(this.em, "LearningModule")}
            WHERE "goalId" = ? AND "generationStatus" = 'pending'`, [input.goalId]))[0];
            if (numberValue(rowValue(pending, "count")) > 0)
                allExpanded = false;
        }
        if (allExpanded !== input.allExpanded) {
            throw new Error("Cognitive-model publication state changed during finalization");
        }
        const candidate = resultRows(await this.execute(`SELECT "id", "version"
           FROM ${revisionTable}
          WHERE "goalId" = ? AND "inputHash" = ?
            AND "status" = 'candidate'
            AND "snapshotSchemaVersion" = ?
          ORDER BY "version" DESC
          LIMIT 1${lock}`, [input.goalId, input.inputHash, COGNITIVE_MODEL_SCHEMA_VERSION]))[0];
        const now = new Date();
        let candidateId = candidate ? String(rowValue(candidate, "id")) : "";
        let version = candidate ? numberValue(rowValue(candidate, "version")) : 0;
        if (!candidate) {
            const latest = resultRows(await this.execute(`SELECT MAX("version") AS "version"
             FROM ${revisionTable}
            WHERE "goalId" = ?`, [input.goalId]))[0];
            version =
                Math.max(numberValue(rowValue(goal, "cognitiveModelVersion")), numberValue(rowValue(latest, "version"))) + 1;
            candidateId = randomUUID();
            const jsonType = "";
            await this.execute(`INSERT INTO ${revisionTable}
          ("id", "goalId", "version", "status", "scope", "inputHash",
           "snapshotSchemaVersion", "isFullSnapshot", "snapshotJson", "auditJson",
           "createdAt", "updatedAt")
         VALUES (?, ?, ?, 'candidate', 'full', ?, ?, true, '{}'${jsonType},
                 '{"phase":"candidate_created"}'${jsonType}, ?, ?)`, [
                candidateId,
                input.goalId,
                version,
                input.inputHash,
                COGNITIVE_MODEL_SCHEMA_VERSION,
                now,
                now,
            ]);
        }
        const jsonType = "";
        await this.execute(`UPDATE ${revisionTable}
          SET "status" = 'published',
              "snapshotJson" = ?${jsonType},
              "auditJson" = ?${jsonType},
              "publishedAt" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'candidate'`, [input.snapshotJson, input.auditJson, now, now, candidateId]);
        await this.execute(`UPDATE ${revisionTable}
          SET "status" = 'superseded', "updatedAt" = ?
        WHERE "goalId" = ? AND "status" = 'published' AND "id" <> ?`, [now, input.goalId, candidateId]);
        const superseded = resultRows(await this.execute(`SELECT "id"
           FROM ${revisionTable}
          WHERE "goalId" = ? AND "status" = 'superseded'
          ORDER BY "version" DESC`, [input.goalId]));
        for (const stale of superseded.slice(1)) {
            await this.execute(`DELETE FROM ${revisionTable} WHERE "id" = ? AND "status" = 'superseded'`, [String(rowValue(stale, "id"))]);
        }
        await this.execute(`UPDATE ${goalTable}
          SET "cognitiveModelVersion" = ?,
              "cognitiveModelPublishedHash" = ?,
              "cognitiveModelStatus" = ?,
              "updatedAt" = ?
        WHERE "id" = ? AND "cognitiveModelInputHash" = ?`, [
            version,
            input.inputHash,
            allExpanded ? "ready" : "building",
            now,
            input.goalId,
            input.inputHash,
        ]);
        return this.result(input, version);
    }
    private result(input: FinalizeCognitiveModelPublicationInput, version: number): CognitiveModelPublicationFinalizationResult {
        return {
            goalId: input.goalId,
            unitId: input.unitId,
            inputHash: input.inputHash,
            status: "already_expanded",
            published: true,
            version,
        };
    }
}
