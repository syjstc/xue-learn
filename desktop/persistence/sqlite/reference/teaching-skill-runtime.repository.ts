import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { EntityManager } from "@mikro-orm/core";
import type { TeachingSkillRuntimeBinding, TeachingSkillRuntimePersistence, } from "@xue-learn/core/server/teaching-skills/persistence";
import { validateTeachingSkillPackage } from "@xue-learn/core/server/teaching-skills/package";
import { builtinRoot, readPackageDirectory, } from "@xue-learn/core/server/teaching-skills/builtin-files";
type Row = Readonly<Record<string, unknown>>;
const GENERAL_TEACHING_SKILL_SLUG = "general-teaching";
const BUILTINS = [
    GENERAL_TEACHING_SKILL_SLUG,
    "language-learning",
    "coding-by-building",
    "mathematics",
] as const;
type BuiltinPackage = Readonly<{
    skillMd: string;
    name: string;
    description: string;
    contentHash: string;
    adapter: Readonly<{
        slug: string;
        topicCategory: string;
        domainPaths: string[];
        tags: string[];
        learningModes: string[];
        appliesTo: string[];
        references: Array<{
            path: string;
            appliesTo: string[];
            keywords: string[];
        }>;
    }>;
    files: Array<{
        path: string;
        content: string;
        appliesTo: string[];
        keywords: string[];
    }>;
}>;
function teachingSkillSearchText(pkg: {
    name: string;
    description: string;
    adapter: {
        topicCategory: string;
        domainPaths: readonly string[];
        tags: readonly string[];
        learningModes: readonly string[];
    };
}): string {
    return [
        pkg.name,
        pkg.description,
        pkg.adapter.topicCategory,
        ...pkg.adapter.domainPaths,
        ...pkg.adapter.tags,
        ...pkg.adapter.learningModes,
    ]
        .join(" ")
        .toLocaleLowerCase();
}
function builtinPackage(files: Record<string, string>): BuiltinPackage {
    const skillMd = files["SKILL.md"]!;
    const frontmatter = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n[\s\S]*$/);
    if (!frontmatter)
        throw new Error("Invalid builtin teaching skill");
    const fields = new Map(frontmatter[1]!.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
        return match
            ? [
                [
                    match[1]!,
                    match[2]!.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2"),
                ],
            ]
            : [];
    }));
    const adapter = JSON.parse(files["xuelearn.json"]!) as BuiltinPackage["adapter"];
    const canonical = Object.entries(files)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, content]) => `${path}\0${content}`)
        .join("\0");
    return {
        skillMd,
        name: fields.get("name") ?? adapter.slug,
        description: fields.get("description") ?? "",
        adapter,
        contentHash: createHash("sha256").update(canonical).digest("hex"),
        files: adapter.references.map((reference) => ({
            ...reference,
            content: files[reference.path]!,
        })),
    };
}
function rows(result: unknown): readonly Row[] {
    if (Array.isArray(result))
        return result as Row[];
    if (result && typeof result === "object" && "rows" in result) {
        const value = (result as {
            rows?: unknown;
        }).rows;
        return Array.isArray(value) ? (value as Row[]) : [];
    }
    return [];
}
function affected(result: unknown): number {
    if (typeof result === "number")
        return result;
    if (!result || typeof result !== "object")
        return 0;
    return Number((result as {
        affectedRows?: unknown;
        rowCount?: unknown;
    }).affectedRows ??
        (result as {
            rowCount?: unknown;
        }).rowCount ??
        0);
}
function value(row: Row, key: string): unknown {
    return row[key] ?? row[key[0]?.toLowerCase() + key.slice(1)];
}
function json(value: unknown): unknown {
    return typeof value === "string" ? JSON.parse(value) : value;
}
function table(em: EntityManager, name: string): string {
    const schema = em.schema ?? em.config?.getSchema();
    const quoted = `"${name.replaceAll('"', '""')}"`;
    return schema ? `"${schema.replaceAll('"', '""')}".${quoted}` : quoted;
}
export class MikroOrmTeachingSkillRuntimeRepository implements TeachingSkillRuntimePersistence {
    constructor(private readonly em: EntityManager) { }
    private execute(em: EntityManager, sql: string, params: unknown[] = []) {
        return em
            .getConnection()
            .execute(sql, params, undefined, em.getTransactionContext());
    }
    async ensureBuiltins() {
        await this.em.transactional(async (em) => {
            for (const slug of BUILTINS) {
                const pkg = builtinPackage(await readPackageDirectory(join(builtinRoot(), slug)));
                const existing = rows(await this.execute(em, `SELECT s."id", v."contentHash" FROM ${table(em, "TeachingSkill")} s LEFT JOIN ${table(em, "TeachingSkillVersion")} v ON v."id" = s."currentPublishedVersionId" WHERE s."slug" = ? LIMIT 1`, [slug]))[0];
                if (existing && value(existing, "contentHash") === pkg.contentHash)
                    continue;
                const skillId = existing ? String(value(existing, "id")) : randomUUID();
                const now = new Date();
                await this.execute(em, `INSERT INTO ${table(em, "TeachingSkill")} ("id","slug","source","status","createdAt","updatedAt") VALUES (?, ?, 'builtin', 'active', ?, ?) ON CONFLICT ("slug") DO UPDATE SET "source" = 'builtin', "status" = 'active', "updatedAt" = excluded."updatedAt"`, [skillId, slug, now, now]);
                const max = rows(await this.execute(em, `SELECT MAX("version") AS "version" FROM ${table(em, "TeachingSkillVersion")} WHERE "skillId" = ?`, [skillId]))[0];
                const versionId = randomUUID();
                const version = Number(value(max ?? {}, "version") ?? 0) + 1;
                await this.execute(em, `INSERT INTO ${table(em, "TeachingSkillVersion")} ("id","skillId","version","status","name","description","topicCategory","domainPaths","tags","learningModes","appliesTo","skillMd","adapterJson","contentHash","searchText","indexStatus","indexError","publishedAt","createdAt","updatedAt") VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?)`, [
                    versionId,
                    skillId,
                    version,
                    pkg.name,
                    pkg.description,
                    pkg.adapter.topicCategory,
                    JSON.stringify(pkg.adapter.domainPaths),
                    JSON.stringify(pkg.adapter.tags),
                    JSON.stringify(pkg.adapter.learningModes),
                    JSON.stringify(pkg.adapter.appliesTo),
                    pkg.skillMd,
                    JSON.stringify(pkg.adapter),
                    pkg.contentHash,
                    teachingSkillSearchText(pkg),
                    now,
                    now,
                    now,
                ]);
                for (const [index, file] of pkg.files.entries()) {
                    await this.execute(em, `INSERT INTO ${table(em, "TeachingSkillFile")} ("id","versionId","path","content","contentHash","appliesTo","keywords","orderIndex","createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                        randomUUID(),
                        versionId,
                        file.path,
                        file.content,
                        createHash("sha256").update(file.content).digest("hex"),
                        JSON.stringify(file.appliesTo),
                        JSON.stringify(file.keywords),
                        index,
                        now,
                    ]);
                }
                await this.execute(em, `UPDATE ${table(em, "TeachingSkill")} SET "currentPublishedVersionId" = ?, "updatedAt" = ? WHERE "id" = ?`, [versionId, now, skillId]);
                await this.execute(em, `INSERT INTO ${table(em, "EventOutbox")} ("id","type","payload","createdAt","attemptCount") VALUES (?, 'teaching_skill.index', ?, ?, 0)`, [randomUUID(), JSON.stringify({ versionId }), now]);
            }
        });
    }
    async listAdmin(input: {
        query?: string;
        status?: string;
        category?: string;
        path?: string;
        tag?: string;
    }) {
        await this.ensureBuiltins();
        const filters = ["1 = 1"];
        const params: unknown[] = [];
        if (input.status) {
            filters.push(`s."status" = ?`);
            params.push(input.status);
        }
        if (input.category) {
            filters.push(`p."topicCategory" = ?`);
            params.push(input.category);
        }
        for (const term of [input.query, input.path, input.tag]) {
            if (!term)
                continue;
            filters.push(`(LOWER(s."slug") LIKE ? OR LOWER(COALESCE(p."searchText", '')) LIKE ?)`);
            const pattern = `%${term.toLocaleLowerCase()}%`;
            params.push(pattern, pattern);
        }
        const source = rows(await this.execute(this.em, `SELECT s.*, p."id" AS "publishedId", p."version" AS "publishedVersion", p."name" AS "publishedName", p."description" AS "publishedDescription", p."topicCategory" AS "publishedTopicCategory", p."domainPaths" AS "publishedDomainPaths", p."tags" AS "publishedTags", p."learningModes" AS "publishedLearningModes", p."appliesTo" AS "publishedAppliesTo", p."contentHash" AS "publishedContentHash", p."indexStatus" AS "publishedIndexStatus", p."indexError" AS "publishedIndexError", p."embeddingModel" AS "publishedEmbeddingModel", p."publishedAt" AS "publishedAt", d."id" AS "draftId", d."version" AS "draftVersion", d."name" AS "draftName", d."updatedAt" AS "draftUpdatedAt", (SELECT COUNT(*) FROM ${table(this.em, "GoalTeachingSkillBinding")} b WHERE b."skillId" = s."id") AS "bindingCount" FROM ${table(this.em, "TeachingSkill")} s LEFT JOIN ${table(this.em, "TeachingSkillVersion")} p ON p."id" = s."currentPublishedVersionId" LEFT JOIN ${table(this.em, "TeachingSkillVersion")} d ON d."id" = (SELECT d2."id" FROM ${table(this.em, "TeachingSkillVersion")} d2 WHERE d2."skillId" = s."id" AND d2."status" = 'draft' ORDER BY d2."version" DESC LIMIT 1) WHERE ${filters.join(" AND ")} ORDER BY s."status" ASC, s."updatedAt" DESC`, params));
        return source.map((row) => ({
            id: String(value(row, "id")),
            slug: String(value(row, "slug")),
            source: String(value(row, "source")),
            status: String(value(row, "status")),
            currentPublishedVersionId: value(row, "currentPublishedVersionId") ?? null,
            createdByUserId: value(row, "createdByUserId") ?? null,
            createdAt: value(row, "createdAt"),
            updatedAt: value(row, "updatedAt"),
            currentPublishedVersion: value(row, "publishedId")
                ? {
                    id: value(row, "publishedId"),
                    version: Number(value(row, "publishedVersion")),
                    name: value(row, "publishedName"),
                    description: value(row, "publishedDescription"),
                    topicCategory: value(row, "publishedTopicCategory"),
                    domainPaths: json(value(row, "publishedDomainPaths")),
                    tags: json(value(row, "publishedTags")),
                    learningModes: json(value(row, "publishedLearningModes")),
                    appliesTo: json(value(row, "publishedAppliesTo")),
                    contentHash: value(row, "publishedContentHash"),
                    indexStatus: value(row, "publishedIndexStatus"),
                    indexError: value(row, "publishedIndexError"),
                    embeddingModel: value(row, "publishedEmbeddingModel") ?? null,
                    publishedAt: value(row, "publishedAt") ?? null,
                }
                : null,
            versions: value(row, "draftId")
                ? [
                    {
                        id: value(row, "draftId"),
                        version: Number(value(row, "draftVersion")),
                        name: value(row, "draftName"),
                        updatedAt: value(row, "draftUpdatedAt"),
                    },
                ]
                : [],
            _count: { goalBindings: Number(value(row, "bindingCount") ?? 0) },
        }));
    }
    async findAdmin(id: string) {
        await this.ensureBuiltins();
        const skill = rows(await this.execute(this.em, `SELECT s.*, (SELECT COUNT(*) FROM ${table(this.em, "GoalTeachingSkillBinding")} b WHERE b."skillId" = s."id") AS "bindingCount" FROM ${table(this.em, "TeachingSkill")} s WHERE s."id" = ? LIMIT 1`, [id]))[0];
        if (!skill)
            return null;
        const versions = rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "TeachingSkillVersion")} WHERE "skillId" = ? ORDER BY "version" DESC`, [id]));
        const mapped: Array<Record<string, unknown> & {
            id: unknown;
        }> = [];
        for (const version of versions) {
            const versionId = String(value(version, "id"));
            const files = rows(await this.execute(this.em, `SELECT * FROM ${table(this.em, "TeachingSkillFile")} WHERE "versionId" = ? ORDER BY "orderIndex" ASC`, [versionId])).map((file) => ({
                ...file,
                appliesTo: json(value(file, "appliesTo")),
                keywords: json(value(file, "keywords")),
            }));
            mapped.push({
                ...version,
                id: value(version, "id"),
                domainPaths: json(value(version, "domainPaths")),
                tags: json(value(version, "tags")),
                learningModes: json(value(version, "learningModes")),
                appliesTo: json(value(version, "appliesTo")),
                adapterJson: json(value(version, "adapterJson")),
                files,
            });
        }
        const currentId = value(skill, "currentPublishedVersionId");
        return {
            ...skill,
            versions: mapped,
            currentPublishedVersion: mapped.find((version) => version.id === currentId) ?? null,
            _count: { goalBindings: Number(value(skill, "bindingCount") ?? 0) },
        };
    }
    async saveDraft(input: {
        files: Record<string, string>;
        adminUserId?: string;
        source?: "admin" | "builtin";
    }) {
        const pkg = validateTeachingSkillPackage(input.files);
        return this.em.transactional(async (em) => {
            const now = new Date();
            let skill = rows(await this.execute(em, `SELECT * FROM ${table(em, "TeachingSkill")} WHERE "slug" = ? LIMIT 1`, [pkg.adapter.slug]))[0];
            if (skill &&
                value(skill, "source") === "builtin" &&
                input.source !== "builtin") {
                throw new Error("Built-in skills cannot be edited from the admin API");
            }
            const skillId = skill ? String(value(skill, "id")) : randomUUID();
            if (!skill) {
                await this.execute(em, `INSERT INTO ${table(em, "TeachingSkill")} ("id","slug","source","status","createdByUserId","createdAt","updatedAt") VALUES (?, ?, ?, 'active', ?, ?, ?)`, [
                    skillId,
                    pkg.adapter.slug,
                    input.source ?? "admin",
                    input.adminUserId ?? null,
                    now,
                    now,
                ]);
            }
            const draft = rows(await this.execute(em, `SELECT "id","version" FROM ${table(em, "TeachingSkillVersion")} WHERE "skillId" = ? AND "status" = 'draft' ORDER BY "version" DESC LIMIT 1`, [skillId]))[0];
            const maximum = rows(await this.execute(em, `SELECT MAX("version") AS "version" FROM ${table(em, "TeachingSkillVersion")} WHERE "skillId" = ?`, [skillId]))[0];
            const versionId = draft ? String(value(draft, "id")) : randomUUID();
            const versionNumber = draft
                ? Number(value(draft, "version"))
                : Number(value(maximum ?? {}, "version") ?? 0) + 1;
            const fields: unknown[] = [
                pkg.name,
                pkg.description,
                pkg.adapter.topicCategory,
                JSON.stringify(pkg.adapter.domainPaths),
                JSON.stringify(pkg.adapter.tags),
                JSON.stringify(pkg.adapter.learningModes),
                JSON.stringify(pkg.adapter.appliesTo),
                pkg.skillMd,
                JSON.stringify(pkg.adapter),
                pkg.contentHash,
                teachingSkillSearchText(pkg),
                input.adminUserId ?? null,
                now,
            ];
            if (draft) {
                await this.execute(em, `UPDATE ${table(em, "TeachingSkillVersion")} SET "name"=?,"description"=?,"topicCategory"=?,"domainPaths"=?,"tags"=?,"learningModes"=?,"appliesTo"=?,"skillMd"=?,"adapterJson"=?,"contentHash"=?,"searchText"=?,"createdByUserId"=?,"indexStatus"='pending',"indexError"='',"updatedAt"=? WHERE "id"=?`, [...fields, versionId]);
            }
            else {
                await this.execute(em, `INSERT INTO ${table(em, "TeachingSkillVersion")} ("id","skillId","version","status","name","description","topicCategory","domainPaths","tags","learningModes","appliesTo","skillMd","adapterJson","contentHash","searchText","createdByUserId","indexStatus","indexError","createdAt","updatedAt") VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)`, [versionId, skillId, versionNumber, ...fields.slice(0, -1), now, now]);
            }
            await this.execute(em, `DELETE FROM ${table(em, "TeachingSkillFile")} WHERE "versionId" = ?`, [versionId]);
            for (const [index, file] of pkg.files.entries()) {
                await this.execute(em, `INSERT INTO ${table(em, "TeachingSkillFile")} ("id","versionId","path","content","contentHash","appliesTo","keywords","orderIndex","createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                    randomUUID(),
                    versionId,
                    file.path,
                    file.content,
                    createHash("sha256").update(file.content).digest("hex"),
                    JSON.stringify(file.appliesTo),
                    JSON.stringify(file.keywords),
                    index,
                    now,
                ]);
            }
            await this.execute(em, `UPDATE ${table(em, "TeachingSkill")} SET "updatedAt" = ? WHERE "id" = ?`, [now, skillId]);
            return { skillId, versionId };
        });
    }
    async publishDraft(skillId: string) {
        return this.em.transactional(async (em) => {
            const draft = rows(await this.execute(em, `SELECT "id" FROM ${table(em, "TeachingSkillVersion")} WHERE "skillId" = ? AND "status" = 'draft' ORDER BY "version" DESC LIMIT 1`, [skillId]))[0];
            if (!draft)
                throw new Error("Teaching skill has no draft to publish");
            const versionId = String(value(draft, "id"));
            const now = new Date();
            await this.execute(em, `UPDATE ${table(em, "TeachingSkillVersion")} SET "status"='published',"publishedAt"=?,"updatedAt"=? WHERE "id"=?`, [now, now, versionId]);
            await this.execute(em, `UPDATE ${table(em, "TeachingSkill")} SET "status"='active',"currentPublishedVersionId"=?,"updatedAt"=? WHERE "id"=?`, [versionId, now, skillId]);
            await this.execute(em, `INSERT INTO ${table(em, "EventOutbox")} ("id","type","payload","createdAt","attemptCount") VALUES (?, 'teaching_skill.index', ?, ?, 0)`, [randomUUID(), JSON.stringify({ versionId }), now]);
            return versionId;
        });
    }
    async archive(skillId: string) {
        const result = await this.execute(this.em, `UPDATE ${table(this.em, "TeachingSkill")} SET "status"='archived',"updatedAt"=? WHERE "id"=?`, [new Date(), skillId]);
        return affected(result) > 0;
    }
    async findPublishedVersionId(skillId: string) {
        const row = rows(await this.execute(this.em, `SELECT "currentPublishedVersionId" FROM ${table(this.em, "TeachingSkill")} WHERE "id" = ? LIMIT 1`, [skillId]))[0];
        const id = row && value(row, "currentPublishedVersionId");
        return id ? String(id) : null;
    }
    async exportFiles(versionId: string) {
        const version = rows(await this.execute(this.em, `SELECT "skillMd","adapterJson" FROM ${table(this.em, "TeachingSkillVersion")} WHERE "id" = ? LIMIT 1`, [versionId]))[0];
        if (!version)
            throw new Error("Teaching skill version not found");
        const files = rows(await this.execute(this.em, `SELECT "path","content" FROM ${table(this.em, "TeachingSkillFile")} WHERE "versionId" = ? ORDER BY "orderIndex" ASC`, [versionId]));
        return Object.fromEntries([
            ["SKILL.md", String(value(version, "skillMd"))],
            [
                "xuelearn.json",
                JSON.stringify(json(value(version, "adapterJson")), null, 2),
            ],
            ...files.map((file) => [
                String(value(file, "path")),
                String(value(file, "content")),
            ]),
        ]);
    }
    async findGoal(goalId: string) {
        const row = rows(await this.execute(this.em, `SELECT "id","title","level","generationOptions" FROM ${table(this.em, "LearningGoal")} WHERE "id" = ? LIMIT 1`, [goalId]))[0];
        return row
            ? {
                id: String(value(row, "id")),
                title: String(value(row, "title")),
                level: String(value(row, "level")),
                generationOptions: json(value(row, "generationOptions")),
            }
            : null;
    }
    async findIndexSource(versionId: string) {
        const row = rows(await this.execute(this.em, `SELECT "id","searchText" FROM ${table(this.em, "TeachingSkillVersion")} WHERE "id" = ? LIMIT 1`, [versionId]))[0];
        return row
            ? {
                id: String(value(row, "id")),
                searchText: String(value(row, "searchText")),
            }
            : null;
    }
    async listIndexSources(input: {
        provider: string;
        model: string;
        limit: number;
    }) {
        return rows(await this.execute(this.em, `SELECT "id","searchText" FROM ${table(this.em, "TeachingSkillVersion")} WHERE "status"='published' AND ("indexStatus" <> 'ready' OR "embeddingProvider" IS NULL OR "embeddingProvider" <> ? OR "embeddingModel" IS NULL OR "embeddingModel" <> ?) ORDER BY "updatedAt" ASC, "id" ASC LIMIT ?`, [input.provider, input.model, input.limit])).map((row) => ({
            id: String(value(row, "id")),
            searchText: String(value(row, "searchText")),
        }));
    }
    async saveIndexResult(input: {
        versionId: string;
        vector?: readonly number[];
        provider?: string;
        model?: string;
        error?: string;
    }) {
        if (input.vector?.length) {
            await this.execute(this.em, `UPDATE ${table(this.em, "TeachingSkillVersion")} SET "embedding"=?,"embeddingProvider"=?,"embeddingModel"=?,"embeddingDimensions"=?,"indexStatus"='ready',"indexError"='',"updatedAt"=? WHERE "id"=?`, [
                `[${input.vector.join(",")}]`,
                input.provider ?? null,
                input.model ?? null,
                input.vector.length,
                new Date(),
                input.versionId,
            ]);
            return;
        }
        await this.execute(this.em, `UPDATE ${table(this.em, "TeachingSkillVersion")} SET "indexStatus"='failed',"indexError"=?,"updatedAt"=? WHERE "id"=?`, [
            (input.error ?? "Indexing failed").slice(0, 1000),
            new Date(),
            input.versionId,
        ]);
    }
    private async bindings(goalId: string, primaryOnly: boolean) {
        const source = rows(await this.execute(this.em, `SELECT b."id" AS "bindingId", b."role", s."id" AS "skillId", s."slug", v."id" AS "versionId", v."version", v."name", v."contentHash", v."appliesTo", v."skillMd" FROM ${table(this.em, "GoalTeachingSkillBinding")} b JOIN ${table(this.em, "TeachingSkill")} s ON s."id" = b."skillId" LEFT JOIN ${table(this.em, "TeachingSkillVersion")} v ON v."id" = s."currentPublishedVersionId" WHERE b."goalId" = ? ${primaryOnly ? `AND b."role" = 'primary'` : `AND (b."role" = 'primary' OR b."role" LIKE 'helper:%')`} ORDER BY CASE WHEN b."role" = 'primary' THEN 0 ELSE 1 END, b."role" ASC`, [goalId]));
        const result: TeachingSkillRuntimeBinding[] = [];
        for (const row of source) {
            const versionId = value(row, "versionId");
            const files = value(row, "contentHash")
                ? rows(await this.execute(this.em, `SELECT "path","content","appliesTo","keywords" FROM ${table(this.em, "TeachingSkillFile")} WHERE "versionId" = ? ORDER BY "orderIndex" ASC`, [versionId])).map((file) => ({
                    path: String(value(file, "path")),
                    content: String(value(file, "content")),
                    appliesTo: json(value(file, "appliesTo")),
                    keywords: json(value(file, "keywords")),
                }))
                : [];
            result.push({
                id: String(value(row, "bindingId")),
                role: String(value(row, "role")),
                skill: {
                    id: String(value(row, "skillId")),
                    slug: String(value(row, "slug")),
                },
                currentPublishedVersion: value(row, "contentHash")
                    ? {
                        version: Number(value(row, "version")),
                        name: String(value(row, "name")),
                        contentHash: String(value(row, "contentHash")),
                        appliesTo: json(value(row, "appliesTo")),
                        skillMd: String(value(row, "skillMd")),
                        files,
                    }
                    : null,
            });
        }
        return result;
    }
    async findPrimaryBinding(goalId: string) {
        return (await this.bindings(goalId, true))[0] ?? null;
    }
    async loadBindings(goalId: string) {
        return this.bindings(goalId, false);
    }
    async findCandidates(query: string, embedding: readonly number[] | null, identity?: Readonly<{
        provider: string;
        model: string;
    }>) {
        const terms = query
            .toLocaleLowerCase()
            .split(/[^\p{L}\p{N}_+-]+/u)
            .filter((term) => term.length > 1);
        const lexical = rows(await this.execute(this.em, `SELECT s."id" AS "skillId", s."slug", v."name", v."description", v."topicCategory", v."domainPaths", v."tags", v."learningModes", v."searchText" FROM ${table(this.em, "TeachingSkill")} s JOIN ${table(this.em, "TeachingSkillVersion")} v ON v."id" = s."currentPublishedVersionId" WHERE s."status" = 'active' AND s."slug" <> ? LIMIT 5000`, [GENERAL_TEACHING_SKILL_SLUG])).map((row) => ({
            skillId: String(value(row, "skillId")),
            slug: String(value(row, "slug")),
            name: String(value(row, "name")),
            description: String(value(row, "description")),
            topicCategory: String(value(row, "topicCategory")),
            domainPaths: json(value(row, "domainPaths")),
            tags: json(value(row, "tags")),
            learningModes: json(value(row, "learningModes")),
            score: terms.reduce((score, term) => score +
                (String(value(row, "searchText")).toLocaleLowerCase().includes(term)
                    ? 1
                    : 0), 0),
        }));
        let semantic: typeof lexical = [];
        let semanticAvailable = Boolean(embedding?.length && identity);
        if (semanticAvailable && true) {
            const state = rows(await this.execute(this.em, `SELECT "status","providerId","model" FROM ${table(this.em, "LocalEmbeddingIndexState")} WHERE "id"='desktop-local' LIMIT 1`))[0];
            semanticAvailable =
                !state ||
                    (String(value(state, "status")) === "published" &&
                        String(value(state, "providerId")) === identity!.provider &&
                        String(value(state, "model")) === identity!.model);
        }
        if (semanticAvailable && embedding?.length && identity) {
            const vectorSql = `[${embedding.join(",")}]`;
            const distance = `vec_distance_cosine(v."embedding", ?)`;
            semantic = rows(await this.execute(this.em, `SELECT s."id" AS "skillId", s."slug", v."name", v."description", v."topicCategory", v."domainPaths", v."tags", v."learningModes", 1 - (${distance}) AS "score" FROM ${table(this.em, "TeachingSkill")} s JOIN ${table(this.em, "TeachingSkillVersion")} v ON v."id" = s."currentPublishedVersionId" WHERE s."status" = 'active' AND s."slug" <> ? AND v."embedding" IS NOT NULL AND v."embeddingProvider"=? AND v."embeddingModel"=? AND v."embeddingDimensions"=? AND v."indexStatus"='ready' ORDER BY ${distance} LIMIT 20`, [
                vectorSql,
                GENERAL_TEACHING_SKILL_SLUG,
                identity.provider,
                identity.model,
                embedding.length,
                vectorSql,
            ])).map((row) => ({
                skillId: String(value(row, "skillId")),
                slug: String(value(row, "slug")),
                name: String(value(row, "name")),
                description: String(value(row, "description")),
                topicCategory: String(value(row, "topicCategory")),
                domainPaths: json(value(row, "domainPaths")),
                tags: json(value(row, "tags")),
                learningModes: json(value(row, "learningModes")),
                score: Number(value(row, "score")),
            }));
        }
        const merged = new Map<string, (typeof lexical)[number]>();
        for (const candidate of [...semantic, ...lexical]) {
            const current = merged.get(candidate.skillId);
            if (!current || candidate.score > current.score)
                merged.set(candidate.skillId, candidate);
        }
        return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 20);
    }
    async findSkills(ids: readonly string[]) {
        if (!ids.length)
            return [];
        return rows(await this.execute(this.em, `SELECT "id", "slug" FROM ${table(this.em, "TeachingSkill")} WHERE "id" IN (${ids.map(() => "?").join(",")})`, [...ids])).map((row) => ({
            id: String(value(row, "id")),
            slug: String(value(row, "slug")),
        }));
    }
    async findGeneralSkill() {
        const row = rows(await this.execute(this.em, `SELECT "id", "slug" FROM ${table(this.em, "TeachingSkill")} WHERE "slug" = ? LIMIT 1`, [GENERAL_TEACHING_SKILL_SLUG]))[0];
        return row
            ? { id: String(value(row, "id")), slug: String(value(row, "slug")) }
            : null;
    }
    async saveAutomaticBindings(input: {
        goalId: string;
        inputHash: string;
        reason: string;
        primary: {
            skillId: string;
            confidence: number;
            reason: string;
        };
        helpers: readonly {
            skillId: string;
            confidence: number;
            reason: string;
        }[];
    }) {
        await this.em.transactional(async (em) => {
            const now = new Date();
            await this.execute(em, `INSERT INTO ${table(em, "GoalTeachingSkillBinding")} ("id","goalId","skillId","role","selectionSource","selectionReason","selectionConfidence","selectionInputHash","adminLocked","selectedAt","updatedAt") VALUES (?, ?, ?, 'primary', 'automatic', ?, ?, ?, ?, ?, ?) ON CONFLICT ("goalId","role") DO UPDATE SET "skillId" = excluded."skillId", "selectionSource" = 'automatic', "selectionReason" = excluded."selectionReason", "selectionConfidence" = excluded."selectionConfidence", "selectionInputHash" = excluded."selectionInputHash", "adminLocked" = excluded."adminLocked", "selectedAt" = excluded."selectedAt", "updatedAt" = excluded."updatedAt"`, [
                randomUUID(),
                input.goalId,
                input.primary.skillId,
                input.primary.reason || input.reason,
                input.primary.confidence,
                input.inputHash,
                false,
                now,
                now,
            ]);
            await this.execute(em, `DELETE FROM ${table(em, "GoalTeachingSkillBinding")} WHERE "goalId" = ? AND "role" LIKE 'helper:%'`, [input.goalId]);
            for (const [index, helper] of input.helpers.entries()) {
                await this.execute(em, `INSERT INTO ${table(em, "GoalTeachingSkillBinding")} ("id","goalId","skillId","role","selectionSource","selectionReason","selectionConfidence","selectionInputHash","adminLocked","selectedAt","updatedAt") VALUES (?, ?, ?, ?, 'automatic', ?, ?, ?, ?, ?, ?)`, [
                    randomUUID(),
                    input.goalId,
                    helper.skillId,
                    `helper:${index + 1}`,
                    helper.reason,
                    helper.confidence,
                    input.inputHash,
                    false,
                    now,
                    now,
                ]);
            }
        });
        const binding = await this.findPrimaryBinding(input.goalId);
        if (!binding)
            throw new Error("Teaching skill binding is unavailable");
        return binding;
    }
    async setPrimaryBinding(input: {
        goalId: string;
        skillId: string;
        adminLocked: boolean;
    }) {
        const published = rows(await this.execute(this.em, `SELECT "id" FROM ${table(this.em, "TeachingSkill")} WHERE "id" = ? AND "currentPublishedVersionId" IS NOT NULL LIMIT 1`, [input.skillId]))[0];
        if (!published)
            return null;
        await this.em.transactional(async (em) => {
            const now = new Date();
            await this.execute(em, `INSERT INTO ${table(em, "GoalTeachingSkillBinding")} ("id","goalId","skillId","role","selectionSource","selectionReason","selectionConfidence","selectionInputHash","adminLocked","selectedAt","updatedAt") VALUES (?, ?, ?, 'primary', 'admin', 'Selected by administrator', 1, '', ?, ?, ?) ON CONFLICT ("goalId","role") DO UPDATE SET "skillId" = excluded."skillId", "selectionSource" = 'admin', "selectionReason" = 'Selected by administrator', "selectionConfidence" = 1, "selectionInputHash" = '', "adminLocked" = excluded."adminLocked", "selectedAt" = excluded."selectedAt", "updatedAt" = excluded."updatedAt"`, [
                randomUUID(),
                input.goalId,
                input.skillId,
                input.adminLocked,
                now,
                now,
            ]);
            await this.execute(em, `DELETE FROM ${table(em, "GoalTeachingSkillBinding")} WHERE "goalId" = ? AND "skillId" = ? AND "role" LIKE 'helper:%'`, [input.goalId, input.skillId]);
        });
        return this.findPrimaryBinding(input.goalId);
    }
}
