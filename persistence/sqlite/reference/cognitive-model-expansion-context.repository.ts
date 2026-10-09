import type { EntityManager } from "@mikro-orm/core";
import type { CognitiveModelExpansionContext, CognitiveModelExpansionContextRepository, } from "@xue-learn/core/source/libs/domain/src/index.ts";
type Row = Readonly<Record<string, unknown>>;
const rows = (value: unknown): readonly Row[] => {
    if (Array.isArray(value))
        return value as Row[];
    if (value && typeof value === "object" && "rows" in value) {
        const nested = (value as {
            rows?: unknown;
        }).rows;
        return Array.isArray(nested) ? (nested as Row[]) : [];
    }
    return [];
};
const value = (row: Row, key: string): unknown => row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
const string = (candidate: unknown, fallback = ""): string => candidate == null ? fallback : String(candidate);
const number = (candidate: unknown): number => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : 0;
};
const json = (candidate: unknown): unknown => {
    if (typeof candidate !== "string")
        return candidate;
    try {
        return JSON.parse(candidate);
    }
    catch {
        return candidate;
    }
};
const jsonStrings = (candidate: unknown): string[] => {
    const parsed = json(candidate);
    return Array.isArray(parsed)
        ? parsed.flatMap((item) => (typeof item === "string" ? [item] : []))
        : [];
};
const table = (em: EntityManager, name: string): string => {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
};
export class MikroOrmCognitiveModelExpansionContextRepository implements CognitiveModelExpansionContextRepository {
    constructor(private readonly em: EntityManager) { }
    private execute(sql: string, params: unknown[] = []) {
        return this.em
            .getConnection()
            .execute(sql, params, undefined, this.em.getTransactionContext());
    }
    async load(unitId: string): Promise<CognitiveModelExpansionContext | null> {
        const unitTable = table(this.em, "LearningUnit");
        const goalTable = table(this.em, "LearningGoal");
        const moduleTable = table(this.em, "LearningModule");
        const moduleMappingTable = table(this.em, "ModuleLearningTarget");
        const mappingTable = table(this.em, "UnitLearningTarget");
        const targetTable = table(this.em, "LearningTarget");
        const requirementTable = table(this.em, "LearningTargetRequirement");
        const entityTable = table(this.em, "CognitiveEntity");
        const joined = rows(await this.execute(`SELECT u."id", u."goalId", u."moduleId", u."parentUnitId", u."unitKind",
                u."curriculumKey", u."title" AS "unitTitle", u."contentSummary",
                u."prerequisites", u."planningOutcomeRefs", u."moduleCapabilityRefs",
                u."moduleMilestoneRole",
                g."userId", g."goalKind", g."title" AS "goalTitle", g."level",
                g."domainTag", g."topicCategory", g."contentLanguage", g."pathSource",
                g."curriculumVersion", g."mapPlanJson", g."mapPlanStatus",
                g."cognitiveModelInputHash", g."cognitiveModelPublishedHash",
                g."cognitiveModelVersion",
                (SELECT COUNT(*) FROM ${mappingTable} m WHERE m."unitId" = u."id") AS "targetCount"
           FROM ${unitTable} u
           JOIN ${goalTable} g ON g."id" = u."goalId"
          WHERE u."id" = ? LIMIT 1`, [unitId]))[0];
        if (!joined)
            return null;
        const goalId = string(value(joined, "goalId"));
        const curriculumRows = rows(await this.execute(`SELECT "id", "curriculumKey", "parentUnitId", "moduleId", "unitKind",
                "title", "contentSummary", "orderIndex", "difficulty", "prerequisites",
                "planAreaRef", "planningOutcomeRefs"
           FROM ${unitTable}
          WHERE "goalId" = ? AND "unitKind" <> 'overview'`, [goalId]));
        const moduleId = value(joined, "moduleId");
        const module = moduleId
            ? rows(await this.execute(`SELECT "id", "curriculumKey", "title", "objective"
               FROM ${moduleTable} WHERE "id" = ? LIMIT 1`, [moduleId]))[0]
            : undefined;
        const moduleTargets = module
            ? rows(await this.execute(`SELECT m."localRef", m."role", t."title", t."learningObjective"
               FROM ${moduleMappingTable} m
               JOIN ${targetTable} t ON t."id" = m."learningTargetId"
              WHERE m."moduleId" = ? ORDER BY m."orderIndex"`, [moduleId]))
            : [];
        const existingRows = rows(await this.execute(`SELECT "id", "stableKey", "kind", "title", "description", "provenance"
           FROM ${entityTable} WHERE "goalId" = ? AND "status" = 'active'`, [goalId]));
        const predecessorIds = jsonStrings(value(joined, "prerequisites"));
        const predecessorRows = predecessorIds.length
            ? rows(await this.execute(`SELECT DISTINCT e."id", e."stableKey", e."kind", e."title", e."description"
               FROM ${entityTable} e
               JOIN ${requirementTable} r ON r."cognitiveEntityId" = e."id"
               JOIN ${mappingTable} m ON m."learningTargetId" = r."learningTargetId"
              WHERE e."goalId" = ? AND e."status" = 'active'
                AND m."isExit" = ${"1"}
                AND m."unitId" IN (${predecessorIds.map(() => "?").join(", ")})`, [goalId, ...predecessorIds]))
            : [];
        const mapEntity = (row: Row) => ({
            id: string(value(row, "id")),
            stableKey: string(value(row, "stableKey")),
            kind: string(value(row, "kind")),
            title: string(value(row, "title")),
            description: string(value(row, "description")),
        });
        return {
            unit: {
                id: unitId,
                goalId,
                moduleId: moduleId == null ? null : string(moduleId),
                parentUnitId: value(joined, "parentUnitId") == null
                    ? null
                    : string(value(joined, "parentUnitId")),
                unitKind: string(value(joined, "unitKind")),
                curriculumKey: string(value(joined, "curriculumKey")),
                title: string(value(joined, "unitTitle")),
                contentSummary: string(value(joined, "contentSummary")),
                prerequisites: string(value(joined, "prerequisites"), "[]"),
                planningOutcomeRefs: json(value(joined, "planningOutcomeRefs")),
                moduleCapabilityRefs: json(value(joined, "moduleCapabilityRefs")),
                moduleMilestoneRole: string(value(joined, "moduleMilestoneRole")),
                hasLearningTargets: number(value(joined, "targetCount")) > 0,
            },
            goal: {
                id: goalId,
                userId: value(joined, "userId") == null
                    ? null
                    : string(value(joined, "userId")),
                goalKind: string(value(joined, "goalKind")),
                title: string(value(joined, "goalTitle")),
                level: string(value(joined, "level")),
                domainTag: string(value(joined, "domainTag")),
                topicCategory: string(value(joined, "topicCategory")),
                contentLanguage: string(value(joined, "contentLanguage")),
                pathSource: string(value(joined, "pathSource")),
                curriculumVersion: number(value(joined, "curriculumVersion")),
                mapPlanJson: string(value(joined, "mapPlanJson")),
                mapPlanStatus: string(value(joined, "mapPlanStatus")),
                cognitiveModelInputHash: string(value(joined, "cognitiveModelInputHash")),
                cognitiveModelPublishedHash: string(value(joined, "cognitiveModelPublishedHash")),
                cognitiveModelVersion: number(value(joined, "cognitiveModelVersion")),
                units: curriculumRows.map((row) => ({
                    id: string(value(row, "id")),
                    curriculumKey: string(value(row, "curriculumKey")),
                    parentUnitId: value(row, "parentUnitId") == null
                        ? null
                        : string(value(row, "parentUnitId")),
                    moduleId: value(row, "moduleId") == null
                        ? null
                        : string(value(row, "moduleId")),
                    unitKind: string(value(row, "unitKind")),
                    title: string(value(row, "title")),
                    contentSummary: string(value(row, "contentSummary")),
                    orderIndex: number(value(row, "orderIndex")),
                    difficulty: string(value(row, "difficulty")),
                    prerequisites: string(value(row, "prerequisites"), "[]"),
                    planAreaRef: string(value(row, "planAreaRef")) || undefined,
                    planningOutcomeRefs: json(value(row, "planningOutcomeRefs")),
                })),
            },
            module: module
                ? {
                    curriculumKey: string(value(module, "curriculumKey")),
                    title: string(value(module, "title")),
                    objective: string(value(module, "objective")),
                    learningTargets: moduleTargets.map((row) => ({
                        localRef: string(value(row, "localRef")),
                        role: string(value(row, "role")),
                        title: string(value(row, "title")),
                        learningObjective: string(value(row, "learningObjective")),
                    })),
                }
                : null,
            existingEntities: existingRows.map((row) => ({
                ...mapEntity(row),
                provenance: json(value(row, "provenance")),
            })),
            predecessorEntities: predecessorRows.map(mapEntity),
        };
    }
}
