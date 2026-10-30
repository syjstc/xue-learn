import { createHash, randomUUID } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";
import type { CognitiveModelPublicationRepository, CognitiveModelPublicationResult, PublishCognitiveModelExpansionInput, } from "@xue-learn/core/domain";
import { orderCurriculumUnits, validateCognitiveModelSnapshot, } from "@xue-learn/core/server/cognitive-model/pure";
import { COGNITIVE_MODEL_SCHEMA_VERSION } from "@xue-learn/core/server/cognitive-model/types";
type Row = Readonly<Record<string, unknown>>;
type JsonRecord = Record<string, unknown>;
type ProposalEntity = JsonRecord & {
    ref: string;
    semanticKey: string;
    kind: "atom" | "concept" | "skill" | "competency";
    title: string;
    description: string;
};
type ProposalRelation = JsonRecord & {
    fromRef: string;
    toRef: string;
    relationType: string;
    strength: "required" | "recommended";
    rationale: string;
};
type ProposalComponent = JsonRecord & {
    constructRef: string;
    componentRef: string;
    requirementMode: string;
    componentGroup: string;
    threshold: number;
    gate: boolean;
    weight: number;
    rationale: string;
};
type ProposalTarget = JsonRecord & {
    ref: string;
    semanticKey: string;
    title: string;
    explanation: string;
    learningObjective: string;
    assessmentCriteria: Array<{
        ref: string;
        text: string;
    }>;
    targetCognitiveLevel: string;
    importance: string;
    importanceWeight: number;
    difficulty: string;
    role: string;
    isEntry: boolean;
    isExit: boolean;
    planningOutcomeRefs: string[];
    requirements: Array<{
        entityRef: string;
        dimension: string;
        required: boolean;
        weight: number;
        threshold: number;
        gate: boolean;
    }>;
};
type ParsedProposal = {
    entities: ProposalEntity[];
    relations: ProposalRelation[];
    components: ProposalComponent[];
    learningTargets: ProposalTarget[];
    audit: JsonRecord;
};
type ExternalEntity = {
    ref: string;
    id: string;
    stableKey: string;
    semanticKey?: string;
    kind: string;
};
const SUPERSEDED_TO_KEEP = 1;
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
function booleanValue(value: unknown): boolean {
    return value === true || value === 1 || value === "1" || value === "true";
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
function jsonRecord(value: unknown): JsonRecord {
    const parsed = parseJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JsonRecord)
        : {};
}
function jsonArray<T>(value: unknown): T[] {
    const parsed = parseJson(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
}
function requiredString(value: unknown, field: string): string {
    const parsed = stringValue(value);
    if (!parsed)
        throw new Error(`Cognitive-model publication missing ${field}`);
    return parsed;
}
function normalizeSemanticKey(value: string): string {
    return value.normalize("NFC").trim().toLowerCase();
}
function digestDefinition(value: unknown): string {
    const normalize = (item: unknown): unknown => {
        if (Array.isArray(item))
            return item.map(normalize);
        if (item && typeof item === "object") {
            return Object.fromEntries(Object.entries(item as JsonRecord)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, normalize(child)]));
        }
        return typeof item === "string" ? item.normalize("NFC").trim() : item;
    };
    return JSON.stringify(normalize(value));
}
function scopedStableKey(curriculumKey: string, kind: string, semanticKey: string): string {
    const digest = createHash("sha256")
        .update(`${curriculumKey}\n${kind}\n${normalizeSemanticKey(semanticKey)}`)
        .digest("hex")
        .slice(0, 24);
    return `${kind}:${digest}`;
}
function parseProposal(input: PublishCognitiveModelExpansionInput): {
    proposal: ParsedProposal;
    externalEntities: ExternalEntity[];
    generationAudit: JsonRecord;
    moduleCapabilityRefs: unknown[];
} {
    const rawProposal = parseJson(input.proposalJson);
    const proposal = rawProposal as Partial<ParsedProposal> | null;
    if (!proposal ||
        !Array.isArray(proposal.entities) ||
        !Array.isArray(proposal.learningTargets)) {
        throw new Error("Invalid cognitive-model publication proposal");
    }
    const externalEntities = parseJson(input.externalEntitiesJson);
    if (!Array.isArray(externalEntities)) {
        throw new Error("Invalid cognitive-model external entity catalog");
    }
    const generationAudit = jsonRecord(input.generationAuditJson);
    const moduleCapabilityRefs = jsonArray<unknown>(input.moduleCapabilityRefsJson);
    return {
        proposal: {
            entities: proposal.entities as ProposalEntity[],
            relations: (proposal.relations ?? []) as ProposalRelation[],
            components: (proposal.components ?? []) as ProposalComponent[],
            learningTargets: proposal.learningTargets as ProposalTarget[],
            audit: jsonRecord(proposal.audit),
        },
        externalEntities: externalEntities as ExternalEntity[],
        generationAudit,
        moduleCapabilityRefs,
    };
}
function qualifiedTable(em: EntityManager, table: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${table.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
function inParams(values: readonly unknown[]): string {
    return values.map(() => "?").join(", ");
}
function parsePrerequisites(value: unknown): string[] {
    return jsonArray<unknown>(value).flatMap((candidate) => typeof candidate === "string" ? [candidate] : []);
}
function snapshotIncludesUnit(value: unknown, unitId: string): boolean {
    const units = jsonRecord(value).units;
    return Array.isArray(units)
        ? units.some((unit) => unit &&
            typeof unit === "object" &&
            (unit as JsonRecord).unitId === unitId &&
            Array.isArray((unit as JsonRecord).learningTargetIds) &&
            ((unit as JsonRecord).learningTargetIds as unknown[]).length > 0)
        : false;
}
function aggregationPolicy(components: readonly {
    requirementMode: string;
    gate: boolean;
}[]): "all_required" | "weighted_geometric" | "alternative_paths" {
    if (components.some((component) => component.requirementMode === "alternative_path")) {
        return "alternative_paths";
    }
    if (components.length > 0 &&
        components.every((component) => component.requirementMode === "required" && component.gate)) {
        return "all_required";
    }
    return "weighted_geometric";
}
export class MikroOrmCognitiveModelPublicationRepository implements CognitiveModelPublicationRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    private jsonType(): string {
        return "";
    }
    private async tableExists(table: string): Promise<boolean> {
        const result = await this.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, [table]);
        return resultRows(result).length > 0;
    }
    async ensureSkeleton(input: {
        goalId: string;
        inputHash: string;
    }) {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const mappingTable = qualifiedTable(this.em, "UnitLearningTarget");
        const revisionTable = qualifiedTable(this.em, "CognitiveModelRevision");
        const moduleTable = qualifiedTable(this.em, "LearningModule");
        const lock = "";
        const jsonType = this.jsonType();
        const now = new Date();
        const goal = resultRows(await this.execute(`SELECT * FROM ${goalTable} WHERE "id" = ?${lock}`, [input.goalId]))[0];
        if (!goal)
            throw new Error("Goal not found");
        const changed = stringValue(rowValue(goal, "cognitiveModelInputHash")) !==
            input.inputHash;
        if (changed) {
            if (numberValue(rowValue(goal, "curriculumVersion")) === 2) {
                await this.execute(`UPDATE ${unitTable} SET "cognitiveModelBuildInputHash" = ?
            WHERE "goalId" = ? AND "unitKind" = 'lesson'
              AND "cognitiveModelStatus" = 'expanded'`, [input.inputHash, input.goalId]);
                await this.execute(`UPDATE ${unitTable}
              SET "cognitiveModelStatus" = 'pending',
                  "cognitiveModelBuildStartedAt" = NULL,
                  "cognitiveModelBuildToken" = NULL,
                  "cognitiveModelBuildInputHash" = NULL
            WHERE "goalId" = ? AND "unitKind" = 'lesson'
              AND "cognitiveModelStatus" <> 'expanded'`, [input.goalId]);
            }
            else {
                await this.execute(`UPDATE ${unitTable}
              SET "cognitiveModelStatus" = 'pending',
                  "cognitiveModelBuildStartedAt" = NULL,
                  "cognitiveModelBuildToken" = NULL,
                  "cognitiveModelBuildInputHash" = NULL
            WHERE "goalId" = ? AND "unitKind" = 'lesson'`, [input.goalId]);
            }
        }
        const latestVersion = resultRows(await this.execute(`SELECT MAX("version") AS "version" FROM ${revisionTable} WHERE "goalId" = ?`, [input.goalId]))[0];
        const nextVersion = Math.max(numberValue(rowValue(goal, "cognitiveModelVersion")), numberValue(rowValue(latestVersion, "version"))) + 1;
        const published = resultRows(await this.execute(`SELECT "id" FROM ${revisionTable}
          WHERE "goalId" = ? AND "status" = 'published' AND "isFullSnapshot" = ${"1"}
          ORDER BY "version" DESC LIMIT 1`, [input.goalId]))[0];
        const unitStates = resultRows(await this.execute(`SELECT u."cognitiveModelStatus", u."cognitiveModelBuildInputHash",
                COUNT(m."id") AS "targetCount"
           FROM ${unitTable} u LEFT JOIN ${mappingTable} m ON m."unitId" = u."id"
          WHERE u."goalId" = ? AND u."unitKind" = 'lesson'
          GROUP BY u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash"`, [input.goalId]));
        let complete = unitStates.every((unit) => stringValue(rowValue(unit, "cognitiveModelStatus")) === "expanded" &&
            stringValue(rowValue(unit, "cognitiveModelBuildInputHash")) ===
                input.inputHash &&
            numberValue(rowValue(unit, "targetCount")) > 0);
        if (numberValue(rowValue(goal, "curriculumVersion")) === 2) {
            const pending = resultRows(await this.execute(`SELECT COUNT(*) AS "count" FROM ${moduleTable}
            WHERE "goalId" = ? AND "generationStatus" = 'pending'`, [input.goalId]))[0];
            complete = complete && numberValue(rowValue(pending, "count")) === 0;
        }
        if (!published) {
            const snapshot = await this.buildSnapshot({
                goalTable,
                unitTable,
                entityTable: qualifiedTable(this.em, "CognitiveEntity"),
                atomTable: qualifiedTable(this.em, "KnowledgeAtom"),
                constructTable: qualifiedTable(this.em, "CognitiveConstruct"),
                componentTable: qualifiedTable(this.em, "ConstructComponent"),
                relationTable: qualifiedTable(this.em, "CognitiveRelation"),
                targetTable: qualifiedTable(this.em, "LearningTarget"),
                requirementTable: qualifiedTable(this.em, "LearningTargetRequirement"),
                unitTargetTable: mappingTable,
                goalId: input.goalId,
                inputHash: input.inputHash,
                phase: "skeleton",
                allExpanded: false,
                generatedUnitId: "",
                generationAudit: {},
                goal,
            });
            const revisionId = randomUUID();
            await this.execute(`INSERT INTO ${revisionTable}
          ("id", "goalId", "version", "status", "scope", "inputHash",
           "snapshotSchemaVersion", "isFullSnapshot", "snapshotJson", "auditJson",
           "publishedAt", "createdAt", "updatedAt")
         VALUES (?, ?, ?, 'published', 'full', ?, ?, ${"1"}, ?${jsonType}, ?${jsonType}, ?, ?, ?)`, [
                revisionId,
                input.goalId,
                nextVersion,
                input.inputHash,
                COGNITIVE_MODEL_SCHEMA_VERSION,
                JSON.stringify(snapshot),
                JSON.stringify(snapshot.audit),
                now,
                now,
                now,
            ]);
            const status = unitStates.length > 0 ? "building" : "ready";
            await this.execute(`UPDATE ${goalTable}
            SET "cognitiveModelEnabled" = ${"1"},
                "cognitiveModelInputHash" = ?, "cognitiveModelPublishedHash" = ?,
                "cognitiveModelVersion" = ?, "cognitiveModelStatus" = ?, "updatedAt" = ?
          WHERE "id" = ?`, [input.inputHash, input.inputHash, nextVersion, status, now, input.goalId]);
            return {
                goalId: input.goalId,
                inputHash: input.inputHash,
                version: nextVersion,
                status,
                changed,
                candidateRevisionId: revisionId,
            };
        }
        if (!changed && complete) {
            await this.execute(`UPDATE ${goalTable}
            SET "cognitiveModelEnabled" = ${"1"},
                "cognitiveModelStatus" = 'ready', "updatedAt" = ? WHERE "id" = ?`, [now, input.goalId]);
            return {
                goalId: input.goalId,
                inputHash: input.inputHash,
                version: numberValue(rowValue(goal, "cognitiveModelVersion")),
                status: "ready",
                changed: false,
                candidateRevisionId: null,
            };
        }
        let candidate = resultRows(await this.execute(`SELECT "id", "version" FROM ${revisionTable}
          WHERE "goalId" = ? AND "inputHash" = ? AND "status" = 'candidate'
            AND "snapshotSchemaVersion" = ? ORDER BY "version" DESC LIMIT 1`, [input.goalId, input.inputHash, COGNITIVE_MODEL_SCHEMA_VERSION]))[0];
        if (!candidate) {
            const id = randomUUID();
            await this.execute(`INSERT INTO ${revisionTable}
          ("id", "goalId", "version", "status", "scope", "inputHash",
           "snapshotSchemaVersion", "isFullSnapshot", "snapshotJson", "auditJson",
           "createdAt", "updatedAt")
         VALUES (?, ?, ?, 'candidate', 'full', ?, ?, ${"1"}, '{}'${jsonType}, ?${jsonType}, ?, ?)`, [
                id,
                input.goalId,
                nextVersion,
                input.inputHash,
                COGNITIVE_MODEL_SCHEMA_VERSION,
                JSON.stringify({ phase: "candidate_created" }),
                now,
                now,
            ]);
            candidate = { id, version: nextVersion };
        }
        const status = numberValue(rowValue(goal, "curriculumVersion")) === 2 ||
            stringValue(rowValue(goal, "cognitiveModelPublishedHash")) ===
                input.inputHash
            ? "building"
            : "needs_reconciliation";
        await this.execute(`UPDATE ${goalTable}
          SET "cognitiveModelEnabled" = ${"1"},
              "cognitiveModelInputHash" = ?, "cognitiveModelStatus" = ?, "updatedAt" = ?
        WHERE "id" = ?`, [input.inputHash, status, now, input.goalId]);
        return {
            goalId: input.goalId,
            inputHash: input.inputHash,
            version: numberValue(rowValue(goal, "cognitiveModelVersion")),
            status,
            changed,
            candidateRevisionId: String(rowValue(candidate, "id")),
        };
    }
    async publishMappingOnlyRevision(input: {
        goalId: string;
        reason: string;
    }): Promise<number> {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const revisionTable = qualifiedTable(this.em, "CognitiveModelRevision");
        const lock = "";
        const now = new Date();
        const goal = resultRows(await this.execute(`SELECT "id", "cognitiveModelInputHash", "cognitiveModelPublishedHash",
                "cognitiveModelVersion", "cognitiveModelStatus", "curriculumVersion",
                "mapPlanJson", "mapPlanStatus"
           FROM ${goalTable} WHERE "id" = ?${lock}`, [input.goalId]))[0];
        if (!goal)
            throw new Error("Goal not found");
        const latest = resultRows(await this.execute(`SELECT MAX("version") AS "version" FROM ${revisionTable} WHERE "goalId" = ?`, [input.goalId]))[0];
        const version = Math.max(numberValue(rowValue(goal, "cognitiveModelVersion")), numberValue(rowValue(latest, "version"))) + 1;
        const snapshot = await this.buildSnapshot({
            goalTable,
            unitTable,
            entityTable: qualifiedTable(this.em, "CognitiveEntity"),
            atomTable: qualifiedTable(this.em, "KnowledgeAtom"),
            constructTable: qualifiedTable(this.em, "CognitiveConstruct"),
            componentTable: qualifiedTable(this.em, "ConstructComponent"),
            relationTable: qualifiedTable(this.em, "CognitiveRelation"),
            targetTable: qualifiedTable(this.em, "LearningTarget"),
            requirementTable: qualifiedTable(this.em, "LearningTargetRequirement"),
            unitTargetTable: qualifiedTable(this.em, "UnitLearningTarget"),
            goalId: input.goalId,
            inputHash: stringValue(rowValue(goal, "cognitiveModelInputHash")) ?? "",
            phase: "mapping_only",
            allExpanded: true,
            generatedUnitId: "",
            generationAudit: {
                source: "mapping_only",
                reason: input.reason,
                preservesLearnerEvidence: true,
            },
            goal,
        });
        const jsonType = this.jsonType();
        await this.execute(`UPDATE ${revisionTable} SET "status" = 'superseded', "updatedAt" = ?
        WHERE "goalId" = ? AND "status" = 'published'`, [now, input.goalId]);
        await this.execute(`INSERT INTO ${revisionTable}
        ("id", "goalId", "version", "status", "scope", "inputHash",
         "snapshotSchemaVersion", "isFullSnapshot", "snapshotJson", "auditJson",
         "publishedAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 'published', 'full', ?, ?, true, ?${jsonType}, ?${jsonType}, ?, ?, ?)`, [
            randomUUID(),
            input.goalId,
            version,
            stringValue(rowValue(goal, "cognitiveModelInputHash")),
            COGNITIVE_MODEL_SCHEMA_VERSION,
            JSON.stringify(snapshot),
            JSON.stringify(snapshot.audit),
            now,
            now,
            now,
        ]);
        await this.execute(`UPDATE ${goalTable}
          SET "cognitiveModelVersion" = ?, "cognitiveModelStatus" = 'ready',
              "cognitiveModelError" = '', "updatedAt" = ? WHERE "id" = ?`, [version, now, input.goalId]);
        const superseded = resultRows(await this.execute(`SELECT "id" FROM ${revisionTable}
          WHERE "goalId" = ? AND "status" = 'superseded' ORDER BY "version" DESC`, [input.goalId]));
        for (const row of superseded.slice(SUPERSEDED_TO_KEEP)) {
            await this.execute(`DELETE FROM ${revisionTable} WHERE "id" = ? AND "status" = 'superseded'`, [rowValue(row, "id")]);
        }
        return version;
    }
    async publishExpandedUnit(input: PublishCognitiveModelExpansionInput): Promise<CognitiveModelPublicationResult> {
        const { proposal, externalEntities, generationAudit, moduleCapabilityRefs, } = parseProposal(input);
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const entityTable = qualifiedTable(this.em, "CognitiveEntity");
        const atomTable = qualifiedTable(this.em, "KnowledgeAtom");
        const constructTable = qualifiedTable(this.em, "CognitiveConstruct");
        const componentTable = qualifiedTable(this.em, "ConstructComponent");
        const relationTable = qualifiedTable(this.em, "CognitiveRelation");
        const targetTable = qualifiedTable(this.em, "LearningTarget");
        const requirementTable = qualifiedTable(this.em, "LearningTargetRequirement");
        const unitTargetTable = qualifiedTable(this.em, "UnitLearningTarget");
        const revisionTable = qualifiedTable(this.em, "CognitiveModelRevision");
        const moduleTable = qualifiedTable(this.em, "LearningModule");
        const lock = "";
        const jsonType = this.jsonType();
        const now = new Date();
        const goal = resultRows(await this.execute(`SELECT "id", "cognitiveModelInputHash", "cognitiveModelPublishedHash",
                "cognitiveModelVersion", "cognitiveModelStatus", "curriculumVersion",
                "mapPlanJson", "mapPlanStatus"
           FROM ${goalTable} WHERE "id" = ?${lock}`, [input.goalId]))[0];
        if (!goal)
            throw new Error("Goal not found");
        if (stringValue(rowValue(goal, "cognitiveModelInputHash")) !== input.inputHash) {
            throw new Error("Course map changed during cognitive-model preparation");
        }
        const unit = resultRows(await this.execute(`SELECT "id", "curriculumKey", "cognitiveModelStatus",
                "cognitiveModelBuildToken", "cognitiveModelBuildInputHash"
           FROM ${unitTable}
          WHERE "id" = ? AND "goalId" = ? AND "unitKind" = 'lesson'${lock}`, [input.unitId, input.goalId]))[0];
        if (!unit ||
            stringValue(rowValue(unit, "cognitiveModelStatus")) !== "building" ||
            stringValue(rowValue(unit, "cognitiveModelBuildToken")) !==
                input.buildToken ||
            stringValue(rowValue(unit, "cognitiveModelBuildInputHash")) !==
                input.inputHash) {
            throw new Error("Cognitive-model expansion reservation became stale");
        }
        const existing = resultRows(await this.execute(`SELECT e."id", e."stableKey", e."kind", e."title", e."description",
                e."language", e."definitionVersion", e."provenance",
                a."atomType", a."statement", a."explanation" AS "atomExplanation",
                a."boundary", a."assessmentHints",
                c."constructType", c."objective", c."inputs", c."outputs",
                c."qualityCriteria", c."compositionStrategy"
           FROM ${entityTable} e
           LEFT JOIN ${atomTable} a ON a."entityId" = e."id"
           LEFT JOIN ${constructTable} c ON c."entityId" = e."id"
          WHERE e."goalId" = ? ORDER BY e."stableKey"`, [input.goalId]));
        const existingByIdentity = new Map<string, Row>();
        for (const row of existing) {
            const semanticKey = stringValue(jsonRecord(rowValue(row, "provenance")).semanticKey);
            if (semanticKey) {
                const key = `${stringValue(rowValue(row, "kind"))}:${normalizeSemanticKey(semanticKey)}`;
                if (!existingByIdentity.has(key))
                    existingByIdentity.set(key, row);
            }
        }
        const externalById = new Map<string, Row>();
        if (externalEntities.length > 0) {
            const rows = resultRows(await this.execute(`SELECT "id", "stableKey", "kind"
             FROM ${entityTable}
            WHERE "goalId" = ? AND "status" = 'active'
              AND "id" IN (${inParams(externalEntities.map((entity) => entity.id))})`, [input.goalId, ...externalEntities.map((entity) => entity.id)]));
            rows.forEach((row) => externalById.set(String(rowValue(row, "id")), row));
        }
        const idsByRef = new Map<string, string>();
        const externalIds = new Set<string>();
        for (const external of externalEntities) {
            if (externalIds.has(external.id) || idsByRef.has(external.ref)) {
                throw new Error("Duplicate cognitive-model external entity identity");
            }
            const row = externalById.get(external.id);
            if (!row ||
                rowValue(row, "stableKey") !== external.stableKey ||
                rowValue(row, "kind") !== external.kind) {
                throw new Error(`Invalid external cognitive entity ${external.ref}`);
            }
            externalIds.add(external.id);
            idsByRef.set(external.ref, external.id);
        }
        const retainedEntityIds = new Set<string>();
        for (const entity of proposal.entities) {
            const normalizedKey = normalizeSemanticKey(entity.semanticKey);
            const previous = existingByIdentity.get(`${entity.kind}:${normalizedKey}`);
            if (previous && externalIds.has(String(rowValue(previous, "id")))) {
                throw new Error(`Generated entity ${entity.ref} duplicates allowlisted external identity`);
            }
            const stableKey = stringValue(rowValue(previous ?? {}, "stableKey")) ??
                (input.pathEntityKeys?.includes(normalizedKey) ? `path:${normalizedKey}` : scopedStableKey(input.curriculumKey, entity.kind, normalizedKey));
            const previousProvenance = jsonRecord(rowValue(previous ?? {}, "provenance"));
            const usedBy = new Set(jsonArray<string>(previousProvenance.usedByCurriculumKeys));
            usedBy.add(input.curriculumKey);
            const previousDefinition = previous
                ? rowValue(previous, "atomType")
                    ? {
                        title: rowValue(previous, "title"),
                        description: rowValue(previous, "description"),
                        statement: rowValue(previous, "statement"),
                        explanation: rowValue(previous, "atomExplanation"),
                        boundary: parseJson(rowValue(previous, "boundary")),
                        atomType: rowValue(previous, "atomType"),
                        assessmentHints: parseJson(rowValue(previous, "assessmentHints")),
                    }
                    : {
                        title: rowValue(previous, "title"),
                        description: rowValue(previous, "description"),
                        objective: rowValue(previous, "objective"),
                        inputs: parseJson(rowValue(previous, "inputs")),
                        outputs: parseJson(rowValue(previous, "outputs")),
                        qualityCriteria: parseJson(rowValue(previous, "qualityCriteria")),
                        compositionStrategy: parseJson(rowValue(previous, "compositionStrategy")),
                    }
                : null;
            const nextDefinition = entity.kind === "atom"
                ? {
                    title: entity.title,
                    description: entity.description,
                    statement: entity.statement,
                    explanation: entity.explanation,
                    boundary: entity.boundary,
                    atomType: entity.knowledgeForm,
                    assessmentHints: entity.assessmentHints,
                }
                : {
                    title: entity.title,
                    description: entity.description,
                    objective: entity.objective,
                    inputs: entity.inputs,
                    outputs: entity.outputs,
                    qualityCriteria: entity.qualityCriteria,
                    compositionStrategy: entity.compositionStrategy,
                };
            const definitionChanged = previousDefinition !== null &&
                digestDefinition(previousDefinition) !==
                    digestDefinition(nextDefinition);
            let entityId = previous ? String(rowValue(previous, "id")) : randomUUID();
            const provenance = JSON.stringify({
                ...previousProvenance,
                semanticKey: normalizedKey,
                ownerCurriculumKey: stringValue(previousProvenance.ownerCurriculumKey) ??
                    input.curriculumKey,
                usedByCurriculumKeys: [...usedBy].sort(),
            });
            if (previous) {
                await this.execute(`UPDATE ${entityTable}
              SET "title" = ?, "description" = ?, "language" = ?, "status" = 'active',
                  "definitionVersion" = "definitionVersion" + ?,
                  "provenance" = ?${jsonType}, "updatedAt" = ?
            WHERE "id" = ?`, [
                    entity.title,
                    entity.description,
                    input.language,
                    definitionChanged ? 1 : 0,
                    provenance,
                    now,
                    entityId,
                ]);
            }
            else {
                await this.execute(`INSERT INTO ${entityTable}
            ("id", "stableKey", "scopeKey", "scope", "goalId", "kind", "title",
             "description", "language", "provenance", "createdAt", "updatedAt")
           VALUES (?, ?, ?, 'goal', ?, ?, ?, ?, ?, ?${jsonType}, ?, ?)`, [
                    entityId,
                    stableKey,
                    `goal:${input.goalId}`,
                    input.goalId,
                    entity.kind,
                    entity.title,
                    entity.description,
                    input.language,
                    provenance,
                    now,
                    now,
                ]);
            }
            idsByRef.set(entity.ref, entityId);
            retainedEntityIds.add(entityId);
            if (entity.kind === "atom") {
                await this.execute(`DELETE FROM ${constructTable} WHERE "entityId" = ?`, [entityId]);
                const atom = {
                    atomType: entity.knowledgeForm,
                    statement: entity.statement,
                    explanation: entity.explanation,
                    boundary: JSON.stringify(entity.boundary),
                    assessmentHints: JSON.stringify(entity.assessmentHints),
                };
                const found = resultRows(await this.execute(`SELECT "entityId" FROM ${atomTable} WHERE "entityId" = ?`, [entityId])).length > 0;
                if (found) {
                    await this.execute(`UPDATE ${atomTable}
                SET "atomType" = ?, "statement" = ?, "explanation" = ?,
                    "boundary" = ?${jsonType}, "assessmentHints" = ?${jsonType}
              WHERE "entityId" = ?`, [
                        atom.atomType,
                        atom.statement,
                        atom.explanation,
                        atom.boundary,
                        atom.assessmentHints,
                        entityId,
                    ]);
                }
                else {
                    await this.execute(`INSERT INTO ${atomTable}
              ("entityId", "atomType", "statement", "explanation", "boundary", "assessmentHints")
             VALUES (?, ?, ?, ?, ?${jsonType}, ?${jsonType})`, [
                        entityId,
                        atom.atomType,
                        atom.statement,
                        atom.explanation,
                        atom.boundary,
                        atom.assessmentHints,
                    ]);
                }
            }
            else {
                await this.execute(`DELETE FROM ${atomTable} WHERE "entityId" = ?`, [
                    entityId,
                ]);
                const construct = {
                    constructType: entity.kind,
                    objective: entity.objective,
                    inputs: JSON.stringify(entity.inputs ?? []),
                    outputs: JSON.stringify(entity.outputs ?? []),
                    qualityCriteria: JSON.stringify(entity.qualityCriteria ?? []),
                    compositionStrategy: JSON.stringify({
                        summary: entity.compositionStrategy,
                    }),
                };
                const found = resultRows(await this.execute(`SELECT "entityId" FROM ${constructTable} WHERE "entityId" = ?`, [entityId])).length > 0;
                if (found) {
                    await this.execute(`UPDATE ${constructTable}
                SET "constructType" = ?, "objective" = ?, "inputs" = ?${jsonType},
                    "outputs" = ?${jsonType}, "qualityCriteria" = ?${jsonType},
                    "compositionStrategy" = ?${jsonType}
              WHERE "entityId" = ?`, [
                        construct.constructType,
                        construct.objective,
                        construct.inputs,
                        construct.outputs,
                        construct.qualityCriteria,
                        construct.compositionStrategy,
                        entityId,
                    ]);
                }
                else {
                    await this.execute(`INSERT INTO ${constructTable}
              ("entityId", "constructType", "objective", "inputs", "outputs",
               "qualityCriteria", "compositionStrategy")
             VALUES (?, ?, ?, ?${jsonType}, ?${jsonType}, ?${jsonType}, ?${jsonType})`, [
                        entityId,
                        construct.constructType,
                        construct.objective,
                        construct.inputs,
                        construct.outputs,
                        construct.qualityCriteria,
                        construct.compositionStrategy,
                    ]);
                }
            }
        }
        const constructIds = proposal.entities
            .filter((entity) => entity.kind !== "atom")
            .map((entity) => idsByRef.get(entity.ref))
            .filter((id): id is string => Boolean(id));
        if (constructIds.length > 0) {
            await this.execute(`DELETE FROM ${componentTable} WHERE "constructId" IN (${inParams(constructIds)})`, constructIds);
        }
        for (const [index, component] of proposal.components.entries()) {
            const constructId = idsByRef.get(component.constructRef);
            const componentEntityId = idsByRef.get(component.componentRef);
            if (!constructId || !componentEntityId)
                throw new Error("Unresolved construct component");
            if (constructId === componentEntityId)
                continue;
            await this.execute(`INSERT INTO ${componentTable}
          ("id", "constructId", "componentEntityId", "relationType", "role",
           "requirementMode", "componentGroup", "threshold", "gate", "weight", "orderIndex", "rationale", "createdAt")
         VALUES (?, ?, ?, 'composed_of', 'primary', ?, ?, ?, ?, ?, ?, ?, ?)`, [
                randomUUID(),
                constructId,
                componentEntityId,
                component.requirementMode,
                component.componentGroup,
                component.threshold,
                component.gate,
                component.weight,
                index,
                component.rationale,
                now,
            ]);
        }
        const resolvedRelations = proposal.relations.map((relation) => {
            let sourceEntityId = idsByRef.get(relation.fromRef);
            let targetEntityId = idsByRef.get(relation.toRef);
            if (!sourceEntityId || !targetEntityId)
                throw new Error("Unresolved cognitive relation");
            if (sourceEntityId === targetEntityId)
                throw new Error("Cognitive relation cannot merge an external alias");
            if (relation.relationType === "contrasts" &&
                sourceEntityId > targetEntityId) {
                [sourceEntityId, targetEntityId] = [targetEntityId, sourceEntityId];
            }
            return { relation, sourceEntityId, targetEntityId };
        });
        const retainedRelationKeys = new Set(resolvedRelations.map(({ relation, sourceEntityId, targetEntityId }) => `${sourceEntityId}\n${targetEntityId}\n${relation.relationType}`));
        const priorRelations = resultRows(await this.execute(`SELECT "id", "sourceEntityId", "targetEntityId", "relationType"
           FROM ${relationTable}
          WHERE "status" = 'active' AND "ownerCurriculumKey" = ?`, [input.curriculumKey]));
        for (const relation of priorRelations) {
            const key = `${rowValue(relation, "sourceEntityId")}\n${rowValue(relation, "targetEntityId")}\n${rowValue(relation, "relationType")}`;
            if (!retainedRelationKeys.has(key)) {
                await this.execute(`UPDATE ${relationTable}
              SET "status" = 'deprecated', "deprecatedModelVersion" = ?, "updatedAt" = ?
            WHERE "id" = ?`, [
                    numberValue(rowValue(goal, "cognitiveModelVersion")) + 1,
                    now,
                    rowValue(relation, "id"),
                ]);
            }
        }
        for (const { relation, sourceEntityId, targetEntityId, } of resolvedRelations) {
            const previous = resultRows(await this.execute(`SELECT "id", "status", "ownerCurriculumKey"
             FROM ${relationTable}
            WHERE "sourceEntityId" = ? AND "targetEntityId" = ? AND "relationType" = ?`, [sourceEntityId, targetEntityId, relation.relationType]))[0];
            if (previous &&
                stringValue(rowValue(previous, "status")) === "active" &&
                stringValue(rowValue(previous, "ownerCurriculumKey")) !==
                    input.curriculumKey) {
                continue;
            }
            const owner = previous && stringValue(rowValue(previous, "status")) !== "deprecated"
                ? (stringValue(rowValue(previous, "ownerCurriculumKey")) ??
                    input.curriculumKey)
                : input.curriculumKey;
            if (previous) {
                await this.execute(`UPDATE ${relationTable}
              SET "ownerCurriculumKey" = ?, "strength" = ?, "required" = ?,
                  "rationale" = ?, "status" = 'active', "deprecatedModelVersion" = NULL,
                  "updatedAt" = ?
            WHERE "id" = ?`, [
                    owner,
                    relation.strength === "required" ? 1 : 0.65,
                    relation.strength === "required",
                    relation.rationale,
                    now,
                    rowValue(previous, "id"),
                ]);
            }
            else {
                await this.execute(`INSERT INTO ${relationTable}
            ("id", "ownerCurriculumKey", "sourceEntityId", "targetEntityId", "relationType",
             "strength", "required", "rationale", "introducedModelVersion", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    randomUUID(),
                    owner,
                    sourceEntityId,
                    targetEntityId,
                    relation.relationType,
                    relation.strength === "required" ? 1 : 0.65,
                    relation.strength === "required",
                    relation.rationale,
                    numberValue(rowValue(goal, "cognitiveModelVersion")) + 1,
                    now,
                    now,
                ]);
            }
        }
        const previousMappings = resultRows(await this.execute(`SELECT "learningTargetId" FROM ${unitTargetTable} WHERE "unitId" = ?`, [input.unitId])).map((row) => String(rowValue(row, "learningTargetId")));
        await this.execute(`DELETE FROM ${unitTargetTable} WHERE "unitId" = ?`, [
            input.unitId,
        ]);
        const retainedTargetIds = new Set<string>();
        for (const [targetIndex, target] of proposal.learningTargets.entries()) {
            const stableKey = scopedStableKey(input.curriculumKey, "target", target.semanticKey);
            const existingTarget = resultRows(await this.execute(`SELECT "id" FROM ${targetTable} WHERE "goalId" = ? AND "stableKey" = ?`, [input.goalId, stableKey]))[0];
            const targetId = existingTarget
                ? String(rowValue(existingTarget, "id"))
                : randomUUID();
            const targetJson = [
                JSON.stringify(target.assessmentCriteria),
                JSON.stringify(target.planningOutcomeRefs),
            ];
            if (existingTarget) {
                await this.execute(`UPDATE ${targetTable}
              SET "title" = ?, "explanation" = ?, "learningObjective" = ?,
                  "assessmentCriteria" = ?${jsonType}, "language" = ?, "importance" = ?,
                  "importanceWeight" = ?, "difficulty" = ?, "targetCognitiveLevel" = ?,
                  "planningOutcomeRefs" = ?${jsonType}, "status" = 'active',
                  "deprecatedModelVersion" = NULL, "updatedAt" = ?
            WHERE "id" = ?`, [
                    target.title,
                    target.explanation,
                    target.learningObjective,
                    targetJson[0],
                    input.language,
                    target.importance,
                    target.importanceWeight,
                    target.difficulty,
                    target.targetCognitiveLevel,
                    targetJson[1],
                    now,
                    targetId,
                ]);
            }
            else {
                await this.execute(`INSERT INTO ${targetTable}
            ("id", "goalId", "stableKey", "title", "explanation", "learningObjective",
             "assessmentCriteria", "language", "importance", "importanceWeight", "difficulty",
             "targetCognitiveLevel", "planningOutcomeRefs", "introducedModelVersion", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?${jsonType}, ?, ?, ?, ?, ?, ?${jsonType}, ?, ?, ?)`, [
                    targetId,
                    input.goalId,
                    stableKey,
                    target.title,
                    target.explanation,
                    target.learningObjective,
                    targetJson[0],
                    input.language,
                    target.importance,
                    target.importanceWeight,
                    target.difficulty,
                    target.targetCognitiveLevel,
                    targetJson[1],
                    numberValue(rowValue(goal, "cognitiveModelVersion")) + 1,
                    now,
                    now,
                ]);
            }
            retainedTargetIds.add(targetId);
            await this.execute(`DELETE FROM ${requirementTable} WHERE "learningTargetId" = ?`, [targetId]);
            for (const [index, requirement] of target.requirements.entries()) {
                const cognitiveEntityId = idsByRef.get(requirement.entityRef);
                if (!cognitiveEntityId)
                    throw new Error(`Unresolved target entity ${requirement.entityRef}`);
                await this.execute(`INSERT INTO ${requirementTable}
            ("id", "learningTargetId", "cognitiveEntityId", "dimension", "required",
             "threshold", "gate", "weight", "orderIndex", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    randomUUID(),
                    targetId,
                    cognitiveEntityId,
                    requirement.dimension,
                    requirement.required,
                    requirement.threshold,
                    requirement.gate,
                    requirement.weight,
                    index,
                    now,
                ]);
            }
            await this.execute(`INSERT INTO ${unitTargetTable}
          ("id", "unitId", "learningTargetId", "localRef", "required", "weight",
           "orderIndex", "role", "isEntry", "isExit", "moduleCapabilityRefs", "moduleRole")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${jsonType}, ?)`, [
                randomUUID(),
                input.unitId,
                targetId,
                target.ref,
                target.importance !== "enrichment",
                target.importanceWeight,
                targetIndex,
                target.role,
                target.isEntry,
                target.isExit,
                JSON.stringify(moduleCapabilityRefs),
                input.moduleRole,
            ]);
        }
        const staleTargetIds = previousMappings.filter((id) => !retainedTargetIds.has(id));
        if (staleTargetIds.length > 0) {
            await this.execute(`UPDATE ${targetTable}
            SET "status" = 'deprecated', "deprecatedModelVersion" = ?, "updatedAt" = ?
          WHERE "id" IN (${inParams(staleTargetIds)})`, [
                numberValue(rowValue(goal, "cognitiveModelVersion")) + 1,
                now,
                ...staleTargetIds,
            ]);
        }
        const currentOwnedIds = existing
            .filter((row) => jsonRecord(rowValue(row, "provenance")).ownerCurriculumKey ===
            input.curriculumKey)
            .map((row) => String(rowValue(row, "id")))
            .filter((id) => !retainedEntityIds.has(id));
        if (currentOwnedIds.length > 0) {
            const used = new Set<string>();
            const targetUsage = resultRows(await this.execute(`SELECT r."cognitiveEntityId"
             FROM ${requirementTable} r
             JOIN ${targetTable} t ON t."id" = r."learningTargetId"
             JOIN ${unitTargetTable} m ON m."learningTargetId" = t."id"
            WHERE t."status" = 'active' AND m."unitId" <> ?
              AND r."cognitiveEntityId" IN (${inParams(currentOwnedIds)})`, [input.unitId, ...currentOwnedIds]));
            targetUsage.forEach((row) => used.add(String(rowValue(row, "cognitiveEntityId"))));
            const relationUsage = resultRows(await this.execute(`SELECT "sourceEntityId", "targetEntityId" FROM ${relationTable}
            WHERE "status" = 'active' AND "ownerCurriculumKey" <> ?
              AND ("sourceEntityId" IN (${inParams(currentOwnedIds)}) OR "targetEntityId" IN (${inParams(currentOwnedIds)}))`, [input.curriculumKey, ...currentOwnedIds, ...currentOwnedIds]));
            relationUsage.forEach((row) => {
                used.add(String(rowValue(row, "sourceEntityId")));
                used.add(String(rowValue(row, "targetEntityId")));
            });
            const componentUsage = resultRows(await this.execute(`SELECT "componentEntityId" FROM ${componentTable}
            WHERE "componentEntityId" IN (${inParams(currentOwnedIds)})
              AND "constructId" NOT IN (${inParams(currentOwnedIds)})`, [...currentOwnedIds, ...currentOwnedIds]));
            componentUsage.forEach((row) => used.add(String(rowValue(row, "componentEntityId"))));
            if (await this.tableExists("TaskRequirement")) {
                const taskRequirementTable = qualifiedTable(this.em, "TaskRequirement");
                const taskUsage = resultRows(await this.execute(`SELECT "cognitiveEntityId" FROM ${taskRequirementTable}
              WHERE "cognitiveEntityId" IN (${inParams(currentOwnedIds)})`, currentOwnedIds));
                taskUsage.forEach((row) => used.add(String(rowValue(row, "cognitiveEntityId"))));
            }
            const deprecate = currentOwnedIds.filter((id) => !used.has(id));
            if (deprecate.length > 0) {
                await this.execute(`UPDATE ${entityTable} SET "status" = 'deprecated', "updatedAt" = ?
            WHERE "id" IN (${inParams(deprecate)})`, [now, ...deprecate]);
            }
        }
        await this.execute(`UPDATE ${unitTable}
          SET "cognitiveModelStatus" = 'expanded', "cognitiveModelBuildStartedAt" = NULL,
              "cognitiveModelBuildToken" = NULL, "cognitiveModelBuildInputHash" = ?
        WHERE "id" = ? AND "goalId" = ? AND "cognitiveModelBuildToken" = ?`, [input.inputHash, input.unitId, input.goalId, input.buildToken]);
        const units = resultRows(await this.execute(`SELECT u."id", u."curriculumKey", u."parentUnitId", u."unitKind", u."title",
                u."orderIndex", u."cognitiveModelStatus", u."planAreaRef",
                u."planningOutcomeRefs", u."prerequisites", u."cognitiveModelBuildInputHash",
                COUNT(m."id") AS "targetCount"
           FROM ${unitTable} u
           LEFT JOIN ${unitTargetTable} m ON m."unitId" = u."id"
          WHERE u."goalId" = ? AND u."unitKind" = 'lesson'
          GROUP BY u."id", u."curriculumKey", u."parentUnitId", u."unitKind", u."title",
                   u."orderIndex", u."cognitiveModelStatus", u."planAreaRef",
                   u."planningOutcomeRefs", u."prerequisites", u."cognitiveModelBuildInputHash"`, [input.goalId]));
        let allExpanded = units.every((row) => rowValue(row, "cognitiveModelStatus") === "expanded" &&
            stringValue(rowValue(row, "cognitiveModelBuildInputHash")) ===
                input.inputHash &&
            numberValue(rowValue(row, "targetCount")) > 0);
        if (numberValue(rowValue(goal, "curriculumVersion")) === 2) {
            const pending = resultRows(await this.execute(`SELECT COUNT(*) AS "count" FROM ${moduleTable}
            WHERE "goalId" = ? AND "generationStatus" = 'pending'`, [input.goalId]))[0];
            if (numberValue(rowValue(pending, "count")) > 0)
                allExpanded = false;
        }
        const latestPublished = resultRows(await this.execute(`SELECT "version", "snapshotJson" FROM ${revisionTable}
          WHERE "goalId" = ? AND "inputHash" = ? AND "status" = 'published'
            AND "isFullSnapshot" = true ORDER BY "version" DESC LIMIT 1`, [input.goalId, input.inputHash]))[0];
        if (latestPublished &&
            snapshotIncludesUnit(parseJson(rowValue(latestPublished, "snapshotJson")), input.unitId)) {
            return {
                goalId: input.goalId,
                unitId: input.unitId,
                inputHash: input.inputHash,
                status: "expanded",
                published: true,
                version: numberValue(rowValue(latestPublished, "version")),
            };
        }
        const publish = allExpanded ||
            rowValue(goal, "cognitiveModelPublishedHash") === input.inputHash;
        const phase = allExpanded
            ? "complete"
            : publish
                ? "incremental"
                : "candidate";
        const candidate = resultRows(await this.execute(`SELECT "id", "version" FROM ${revisionTable}
          WHERE "goalId" = ? AND "inputHash" = ? AND "status" = 'candidate'
            AND "snapshotSchemaVersion" = ? ORDER BY "version" DESC LIMIT 1${lock}`, [input.goalId, input.inputHash, COGNITIVE_MODEL_SCHEMA_VERSION]))[0];
        let candidateId = candidate
            ? String(rowValue(candidate, "id"))
            : randomUUID();
        let version = candidate ? numberValue(rowValue(candidate, "version")) : 0;
        if (!candidate) {
            const latest = resultRows(await this.execute(`SELECT MAX("version") AS "version" FROM ${revisionTable} WHERE "goalId" = ?`, [input.goalId]))[0];
            version =
                Math.max(numberValue(rowValue(goal, "cognitiveModelVersion")), numberValue(rowValue(latest, "version"))) + 1;
            await this.execute(`INSERT INTO ${revisionTable}
          ("id", "goalId", "version", "status", "scope", "inputHash", "snapshotSchemaVersion",
           "isFullSnapshot", "snapshotJson", "auditJson", "createdAt", "updatedAt")
         VALUES (?, ?, ?, 'candidate', 'full', ?, ?, true, '{}'${jsonType}, '{"phase":"candidate_created"}'${jsonType}, ?, ?)`, [
                candidateId,
                input.goalId,
                version,
                input.inputHash,
                COGNITIVE_MODEL_SCHEMA_VERSION,
                now,
                now,
            ]);
        }
        const snapshot = await this.buildSnapshot({
            goalTable,
            unitTable,
            entityTable,
            atomTable,
            constructTable,
            componentTable,
            relationTable,
            targetTable,
            requirementTable,
            unitTargetTable,
            goalId: input.goalId,
            inputHash: input.inputHash,
            phase,
            allExpanded,
            generatedUnitId: input.unitId,
            generationAudit,
            goal,
        });
        const auditJson = JSON.stringify(snapshot.audit);
        await this.execute(`UPDATE ${revisionTable}
          SET "snapshotJson" = ?${jsonType}, "auditJson" = ?${jsonType},
              "status" = ?, "publishedAt" = ?, "updatedAt" = ?
        WHERE "id" = ? AND "status" = 'candidate'`, [
            JSON.stringify(snapshot),
            auditJson,
            publish ? "published" : "candidate",
            publish ? now : null,
            now,
            candidateId,
        ]);
        if (publish) {
            await this.execute(`UPDATE ${revisionTable} SET "status" = 'superseded', "updatedAt" = ?
          WHERE "goalId" = ? AND "status" = 'published' AND "id" <> ?`, [now, input.goalId, candidateId]);
            const superseded = resultRows(await this.execute(`SELECT "id" FROM ${revisionTable} WHERE "goalId" = ? AND "status" = 'superseded' ORDER BY "version" DESC`, [input.goalId]));
            for (const row of superseded.slice(SUPERSEDED_TO_KEEP)) {
                await this.execute(`DELETE FROM ${revisionTable} WHERE "id" = ? AND "status" = 'superseded'`, [rowValue(row, "id")]);
            }
            await this.execute(`UPDATE ${goalTable}
            SET "cognitiveModelVersion" = ?, "cognitiveModelPublishedHash" = ?,
                "cognitiveModelStatus" = ?, "updatedAt" = ?
          WHERE "id" = ? AND "cognitiveModelInputHash" = ?`, [
                version,
                input.inputHash,
                allExpanded ? "ready" : "building",
                now,
                input.goalId,
                input.inputHash,
            ]);
        }
        else {
            await this.execute(`UPDATE ${goalTable} SET "cognitiveModelStatus" = 'needs_reconciliation', "updatedAt" = ?
          WHERE "id" = ? AND "cognitiveModelInputHash" = ?`, [now, input.goalId, input.inputHash]);
        }
        return {
            goalId: input.goalId,
            unitId: input.unitId,
            inputHash: input.inputHash,
            status: "expanded",
            published: publish,
            version: publish
                ? version
                : numberValue(rowValue(goal, "cognitiveModelVersion")),
        };
    }
    async buildExistingExpandedSnapshot(input: {
        goalId: string;
        unitId: string;
        inputHash: string;
    }): Promise<{
        snapshotJson: string;
        auditJson: string;
        allExpanded: boolean;
    } | null> {
        const goalTable = qualifiedTable(this.em, "LearningGoal");
        const unitTable = qualifiedTable(this.em, "LearningUnit");
        const targetTable = qualifiedTable(this.em, "UnitLearningTarget");
        const goal = resultRows(await this.execute(`SELECT * FROM ${goalTable} WHERE "id" = ?`, [input.goalId]))[0];
        if (!goal || stringValue(rowValue(goal, "cognitiveModelInputHash")) !== input.inputHash || stringValue(rowValue(goal, "cognitiveModelPublishedHash")) !== input.inputHash)
            return null;
        const requested = resultRows(await this.execute(`SELECT u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash", COUNT(target."id") AS "targetCount" FROM ${unitTable} u LEFT JOIN ${targetTable} target ON target."unitId" = u."id" WHERE u."id" = ? AND u."goalId" = ? AND u."unitKind" = 'lesson' GROUP BY u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash"`, [input.unitId, input.goalId]))[0];
        if (!requested || stringValue(rowValue(requested, "cognitiveModelStatus")) !== "expanded" || stringValue(rowValue(requested, "cognitiveModelBuildInputHash")) !== input.inputHash || numberValue(rowValue(requested, "targetCount")) === 0)
            return null;
        const units = resultRows(await this.execute(`SELECT u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash", COUNT(target."id") AS "targetCount" FROM ${unitTable} u LEFT JOIN ${targetTable} target ON target."unitId" = u."id" WHERE u."goalId" = ? AND u."unitKind" = 'lesson' GROUP BY u."id", u."cognitiveModelStatus", u."cognitiveModelBuildInputHash"`, [input.goalId]));
        let allExpanded = units.every((unit) => stringValue(rowValue(unit, "cognitiveModelStatus")) === "expanded" && stringValue(rowValue(unit, "cognitiveModelBuildInputHash")) === input.inputHash && numberValue(rowValue(unit, "targetCount")) > 0);
        if (numberValue(rowValue(goal, "curriculumVersion")) === 2) {
            const pending = resultRows(await this.execute(`SELECT COUNT(*) AS "count" FROM ${qualifiedTable(this.em, "LearningModule")} WHERE "goalId" = ? AND "generationStatus" = 'pending'`, [input.goalId]))[0];
            allExpanded = allExpanded && numberValue(rowValue(pending, "count")) === 0;
        }
        const snapshot = await this.buildSnapshot({
            goalTable, unitTable,
            entityTable: qualifiedTable(this.em, "CognitiveEntity"), atomTable: qualifiedTable(this.em, "KnowledgeAtom"),
            constructTable: qualifiedTable(this.em, "CognitiveConstruct"), componentTable: qualifiedTable(this.em, "ConstructComponent"),
            relationTable: qualifiedTable(this.em, "CognitiveRelation"), targetTable: qualifiedTable(this.em, "LearningTarget"),
            requirementTable: qualifiedTable(this.em, "LearningTargetRequirement"), unitTargetTable: targetTable,
            goalId: input.goalId, inputHash: input.inputHash, phase: allExpanded ? "complete" : "incremental", allExpanded,
            generatedUnitId: input.unitId, generationAudit: { promotedExistingUnit: true }, goal,
        });
        return { snapshotJson: JSON.stringify(snapshot), auditJson: JSON.stringify(snapshot.audit), allExpanded };
    }
    private async buildSnapshot(params: {
        goalTable: string;
        unitTable: string;
        entityTable: string;
        atomTable: string;
        constructTable: string;
        componentTable: string;
        relationTable: string;
        targetTable: string;
        requirementTable: string;
        unitTargetTable: string;
        goalId: string;
        inputHash: string;
        phase: string;
        allExpanded: boolean;
        generatedUnitId: string;
        generationAudit: JsonRecord;
        goal: Row;
    }) {
        const entities = resultRows(await this.execute(`SELECT e."id", e."stableKey", e."kind", e."title", e."description", e."language",
                e."definitionVersion", e."status", a."atomType", a."statement",
                a."explanation" AS "atomExplanation", a."boundary", c."objective",
                c."constructType", c."inputs", c."outputs", c."qualityCriteria",
                c."compositionStrategy"
           FROM ${params.entityTable} e
           LEFT JOIN ${params.atomTable} a ON a."entityId" = e."id"
           LEFT JOIN ${params.constructTable} c ON c."entityId" = e."id"
          WHERE e."goalId" = ? AND e."status" = 'active'
          ORDER BY e."kind", e."stableKey"`, [params.goalId]));
        const components = resultRows(await this.execute(`SELECT * FROM ${params.componentTable} ORDER BY "constructId", "orderIndex"`, []));
        const activeEntityIds = new Set(entities.map((row) => String(rowValue(row, "id"))));
        const activeComponents = components.filter((row) => activeEntityIds.has(String(rowValue(row, "constructId"))) &&
            activeEntityIds.has(String(rowValue(row, "componentEntityId"))));
        const relationRows = resultRows(await this.execute(`SELECT * FROM ${params.relationTable} WHERE "status" = 'active' ORDER BY "relationType", "sourceEntityId", "targetEntityId"`, [])).filter((row) => activeEntityIds.has(String(rowValue(row, "sourceEntityId"))) &&
            activeEntityIds.has(String(rowValue(row, "targetEntityId"))));
        const targetRows = resultRows(await this.execute(`SELECT * FROM ${params.targetTable} WHERE "goalId" = ? AND "status" = 'active' ORDER BY "stableKey"`, [params.goalId]));
        const targetIds = targetRows.map((row) => String(rowValue(row, "id")));
        const requirementRows = targetIds.length
            ? resultRows(await this.execute(`SELECT * FROM ${params.requirementTable} WHERE "learningTargetId" IN (${inParams(targetIds)}) ORDER BY "learningTargetId", "orderIndex"`, targetIds))
            : [];
        const mappingRows = targetIds.length
            ? resultRows(await this.execute(`SELECT * FROM ${params.unitTargetTable} WHERE "learningTargetId" IN (${inParams(targetIds)}) ORDER BY "unitId", "orderIndex"`, targetIds))
            : [];
        const requirementsByTarget = new Map<string, Row[]>();
        requirementRows.forEach((row) => {
            const id = String(rowValue(row, "learningTargetId"));
            requirementsByTarget.set(id, [
                ...(requirementsByTarget.get(id) ?? []),
                row,
            ]);
        });
        const mappingsByTarget = new Map<string, Row[]>();
        mappingRows.forEach((row) => {
            const id = String(rowValue(row, "learningTargetId"));
            mappingsByTarget.set(id, [...(mappingsByTarget.get(id) ?? []), row]);
        });
        const snapshotEntities = entities.map((row) => {
            const constructRows = activeComponents.filter((component) => rowValue(component, "constructId") === rowValue(row, "id"));
            return {
                id: String(rowValue(row, "id")),
                stableKey: String(rowValue(row, "stableKey")),
                kind: String(rowValue(row, "kind")),
                title: String(rowValue(row, "title")),
                description: String(rowValue(row, "description")),
                language: String(rowValue(row, "language")),
                definitionVersion: numberValue(rowValue(row, "definitionVersion")),
                status: "active" as const,
                atom: rowValue(row, "atomType")
                    ? {
                        statement: String(rowValue(row, "statement")),
                        explanation: String(rowValue(row, "atomExplanation")),
                        boundary: parseJson(rowValue(row, "boundary")),
                        knowledgeForm: String(rowValue(row, "atomType")),
                    }
                    : null,
                construct: rowValue(row, "constructType") || rowValue(row, "objective")
                    ? {
                        objective: String(rowValue(row, "objective") ?? ""),
                        inputs: jsonArray<string>(rowValue(row, "inputs")),
                        outputs: jsonArray<string>(rowValue(row, "outputs")),
                        qualityCriteria: jsonArray<string>(rowValue(row, "qualityCriteria")),
                        compositionStrategy: parseJson(rowValue(row, "compositionStrategy")),
                        aggregationPolicy: aggregationPolicy(constructRows.map((component) => ({
                            requirementMode: String(rowValue(component, "requirementMode")),
                            gate: booleanValue(rowValue(component, "gate")),
                        }))),
                    }
                    : null,
            };
        });
        const targetIdsByUnit = new Map<string, string[]>();
        const snapshotTargets = targetRows.map((row) => ({
            id: String(rowValue(row, "id")),
            stableKey: String(rowValue(row, "stableKey")),
            title: String(rowValue(row, "title")),
            description: String(rowValue(row, "explanation")),
            learningObjective: String(rowValue(row, "learningObjective")),
            assessmentCriteria: jsonArray<{
                ref: string;
                text: string;
            }>(rowValue(row, "assessmentCriteria")),
            targetCognitiveLevel: String(rowValue(row, "targetCognitiveLevel")),
            importance: String(rowValue(row, "importance")),
            importanceWeight: numberValue(rowValue(row, "importanceWeight")),
            difficulty: String(rowValue(row, "difficulty")),
            planningOutcomeRefs: jsonArray<string>(rowValue(row, "planningOutcomeRefs")),
            requirements: (requirementsByTarget.get(String(rowValue(row, "id"))) ?? []).map((requirement) => ({
                entityId: String(rowValue(requirement, "cognitiveEntityId")),
                dimension: String(rowValue(requirement, "dimension")),
                required: booleanValue(rowValue(requirement, "required")),
                weight: numberValue(rowValue(requirement, "weight")),
                threshold: numberValue(rowValue(requirement, "threshold")),
                gate: booleanValue(rowValue(requirement, "gate")),
            })),
            mappings: (mappingsByTarget.get(String(rowValue(row, "id"))) ?? []).map((mapping) => {
                const unitId = String(rowValue(mapping, "unitId"));
                targetIdsByUnit.set(unitId, [
                    ...(targetIdsByUnit.get(unitId) ?? []),
                    String(rowValue(row, "id")),
                ]);
                return {
                    unitId,
                    localRef: String(rowValue(mapping, "localRef")),
                    required: booleanValue(rowValue(mapping, "required")),
                    weight: numberValue(rowValue(mapping, "weight")),
                    orderIndex: numberValue(rowValue(mapping, "orderIndex")),
                    role: String(rowValue(mapping, "role")),
                    isEntry: booleanValue(rowValue(mapping, "isEntry")),
                    isExit: booleanValue(rowValue(mapping, "isExit")),
                };
            }),
        }));
        const unitRows = resultRows(await this.execute(`SELECT "id", "curriculumKey", "parentUnitId", "unitKind", "title", "orderIndex",
                "cognitiveModelStatus", "planAreaRef", "planningOutcomeRefs", "prerequisites"
           FROM ${params.unitTable} WHERE "goalId" = ? AND "unitKind" <> 'overview'`, [params.goalId]));
        const orderedUnits = orderCurriculumUnits(unitRows.map((row) => ({
            id: String(rowValue(row, "id")),
            curriculumKey: String(rowValue(row, "curriculumKey")),
            parentUnitId: stringValue(rowValue(row, "parentUnitId")),
            unitKind: String(rowValue(row, "unitKind")),
            title: String(rowValue(row, "title")),
            orderIndex: numberValue(rowValue(row, "orderIndex")),
            contentSummary: "",
            difficulty: "",
            prerequisites: String(rowValue(row, "prerequisites") ?? "[]"),
        })));
        const unitById = new Map(unitRows.map((row) => [String(rowValue(row, "id")), row]));
        const snapshot = {
            schemaVersion: COGNITIVE_MODEL_SCHEMA_VERSION,
            goalId: params.goalId,
            inputHash: params.inputHash,
            entities: snapshotEntities,
            relations: relationRows.map((row) => ({
                id: String(rowValue(row, "id")),
                fromEntityId: String(rowValue(row, "sourceEntityId")),
                toEntityId: String(rowValue(row, "targetEntityId")),
                relationType: String(rowValue(row, "relationType")),
                strength: booleanValue(rowValue(row, "required"))
                    ? "required"
                    : "recommended",
                rationale: String(rowValue(row, "rationale")),
                status: "active" as const,
            })),
            components: activeComponents.map((row) => ({
                id: String(rowValue(row, "id")),
                constructId: String(rowValue(row, "constructId")),
                componentEntityId: String(rowValue(row, "componentEntityId")),
                relationType: String(rowValue(row, "relationType")),
                role: String(rowValue(row, "role")),
                requirementMode: String(rowValue(row, "requirementMode")),
                componentGroup: String(rowValue(row, "componentGroup")),
                threshold: numberValue(rowValue(row, "threshold")),
                gate: booleanValue(rowValue(row, "gate")),
                weight: numberValue(rowValue(row, "weight")),
                orderIndex: numberValue(rowValue(row, "orderIndex")),
                rationale: String(rowValue(row, "rationale")),
            })),
            learningTargets: snapshotTargets,
            units: orderedUnits.map((unit, curriculumOrder) => {
                const row = unitById.get(unit.id);
                return {
                    unitId: unit.id,
                    curriculumKey: unit.curriculumKey,
                    title: unit.title,
                    parentUnitId: unit.parentUnitId,
                    unitKind: unit.unitKind,
                    curriculumOrder,
                    modelStatus: String(rowValue(row ?? {}, "cognitiveModelStatus") ?? ""),
                    planAreaRef: String(rowValue(row ?? {}, "planAreaRef") ?? ""),
                    planningOutcomeRefs: jsonArray<string>(rowValue(row ?? {}, "planningOutcomeRefs")),
                    prerequisiteUnitIds: parsePrerequisites(unit.prerequisites),
                    learningTargetIds: targetIdsByUnit.get(unit.id) ?? [],
                };
            }),
            audit: {
                phase: params.phase,
                complete: params.allExpanded,
                generatedUnitId: params.generatedUnitId,
                generationAudit: params.generationAudit,
            } as JsonRecord,
        };
        const planningCoverage = params.allExpanded
            ? rowValue(params.goal, "mapPlanStatus") === "approved"
                ? await (async () => {
                    const [{ validateSnapshotPlanningCoverage }, { parseMapPlan }] = await Promise.all([
                        import("@xue-learn/core/server/cognitive-model/planning-coverage"),
                        import("@xue-learn/core/server/goals/map-plan"),
                    ]);
                    return validateSnapshotPlanningCoverage(snapshot as never, parseMapPlan(String(rowValue(params.goal, "mapPlanJson") ?? "{}")));
                })()
                : { mode: "legacy_unbound" as const, coveredOutcomeRefs: [] }
            : {
                mode: "incremental" as const,
                coveredOutcomeRefs: snapshotTargets.flatMap((target) => target.planningOutcomeRefs ?? []),
            };
        snapshot.audit = { ...snapshot.audit, planningCoverage };
        validateCognitiveModelSnapshot(snapshot as never);
        return snapshot;
    }
}
